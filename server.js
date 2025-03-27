const express = require('express');
const path = require('path');
const WebSocket = require('ws');
const bodyParser = require('body-parser');
const net = require('net');

const app = express();
app.use(bodyParser.json());
const wss = new WebSocket.Server({ noServer: true });

// Data stores with enhanced structures
const activeEmergencies = new Map();
const connectedResponders = new Map(); // responderId -> {ws, location, status, details}
const connectedVolunteers = new Map(); // volunteerId -> {ws, location, status, skills, details}

// Volunteer skill classifications
const VOLUNTEER_SKILLS = {
  medical: ['first-aid', 'cpr', 'emt', 'nurse', 'doctor'],
  rescue: ['swimming', 'climbing', 'firefighting'],
  logistics: ['driver', 'translator', 'counselor']
};

// Indian states for location validation
const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand',
  'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal'
];

// WebSocket message handler
function handleWebSocketMessage(ws, data) {
  try {
    switch (data.type) {
      case 'connect_responder':
        const responderId = generateId();
        connectedResponders.set(responderId, {
          ws,
          location: data.coordinates,
          status: 'available',
          details: {
            name: data.name || 'Responder',
            phone: data.phone || 'N/A'
          }
        });
        ws.send(JSON.stringify({
          type: 'responder_connected',
          responderId: responderId
        }));
        console.log(`Responder connected: ${responderId}`);
        break;
        
      case 'emergency':
        const emergency = createEmergency(data.data);
        notifyResponders(emergency);
        alertNearbyVolunteers(emergency);
        break;
        
      case 'volunteer_response':
        handleVolunteerResponse(data.emergencyId, data.volunteerId, data.response);
        break;
        
      default:
        console.warn('Unknown message type:', data.type);
    }
  } catch (err) {
    console.error('Error handling WebSocket message:', err);
  }
}

// WebSocket connections
wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      handleWebSocketMessage(ws, data);
    } catch (err) {
      console.error('Error parsing WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    // Clean up disconnected clients
    for (const [id, responder] of connectedResponders) {
      if (responder.ws === ws) {
        connectedResponders.delete(id);
        broadcastResponderStatus(id, 'offline');
        break;
      }
    }
    for (const [id, volunteer] of connectedVolunteers) {
      if (volunteer.ws === ws) {
        connectedVolunteers.delete(id);
        break;
      }
    }
  });
});

function handleWebSocketMessage(ws, data) {
  try {
    switch (data.type) {
      case 'responder_register':
        connectedResponders.set(data.responderId, {
          ws,
          location: data.location,
          status: 'available',
          details: {
            name: data.name,
            vehicle: data.vehicle
          }
        });
        broadcastResponderStatus(data.responderId, 'available');
        break;

      case 'responder_location':
        if (connectedResponders.has(data.responderId)) {
          const responder = connectedResponders.get(data.responderId);
          
          // Only update if location changed significantly (>50m)
          const distance = calculateDistance(
            responder.location.lat, 
            responder.location.lng,
            data.location.lat,
            data.location.lng
          );
          
          if (distance > 0.05) { // ~50 meters
            responder.location = data.location;
            responder.lastUpdate = new Date().toISOString();
            broadcastResponderLocation(data.responderId, data.location);
          }
        }
        break;

      case 'responder_status':
        if (connectedResponders.has(data.responderId)) {
          connectedResponders.get(data.responderId).status = data.status;
          broadcastResponderStatus(data.responderId, data.status);
        }
        break;

      case 'volunteer_register':
        try {
          // Validate Indian credentials
          const errors = validateVolunteerData(data);
          if (errors.length > 0) {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Validation failed',
              errors: errors
            }));
            break;
          }

          // Set default Indian details if not provided
          data.firstName = data.firstName || 'Volunteer';
          data.lastName = data.lastName || 'User';
          
          // Classify skills
          const classifiedSkills = classifySkills(data.skills);

          connectedVolunteers.set(data.volunteerId, {
            ws,
            location: validateIndianLocation(data.location),
            skills: classifiedSkills,
            availability: data.availability || [],
            status: 'available',
            details: {
              firstName: data.firstName,
              lastName: data.lastName,
              phone: data.phone,
              languages: data.languages || ['English', 'Hindi']
            },
            lastActive: new Date().toISOString(),
            verification: {
              idProof: null,
              trainingCert: null
            }
          });

          console.log(`New volunteer registered: ${data.firstName} ${data.lastName} (Skills: ${classifiedSkills.join(', ')})`);
          ws.send(JSON.stringify({
            type: 'registration_success',
            volunteerId: data.volunteerId
          }));
        } catch (err) {
          console.error('Volunteer registration error:', err);
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Registration failed',
            error: err.message
          }));
        }
        break;

      case 'volunteer_response':
        handleVolunteerResponse(data.emergencyId, data.volunteerId, data.response);
        break;

      case 'emergency_accept':
        handleEmergencyAcceptance(data.emergencyId, data.responderId);
        break;

      case 'volunteer_complete':
        handleVolunteerCompletion(data.emergencyId, data.volunteerId);
        break;

      default:
        console.warn('Unknown message type:', data.type);
    }
  } catch (err) {
    console.error('Error handling WebSocket message:', err);
  }
}

// Emergency endpoints
app.post('/api/emergency', (req, res) => {
  const emergency = createEmergency(req.body);
  notifyResponders(emergency);
  alertNearbyVolunteers(emergency);
  res.status(201).json(emergency);
});

app.get('/api/emergency/:id', (req, res) => {
  res.json(activeEmergencies.get(req.params.id) || { error: 'Not found' });
});

// Helper functions
function createEmergency(data) {
  // Validate Indian phone number
  const indianPhoneRegex = /^\+91[6-9]\d{9}$/;
  if (!indianPhoneRegex.test(data.contact)) {
    throw new Error('Invalid Indian phone number');
  }

  // Verify location is within India
  if (!data.coordinates?.verified || 
      data.coordinates.lat < 8.4 || data.coordinates.lat > 37.6 ||
      data.coordinates.lng < 68.1 || data.coordinates.lng > 97.4) {
    throw new Error('Location must be within India');
  }

  const emergency = {
    id: generateId(),
    ...data,
    status: 'pending',
    timestamp: new Date().toISOString(),
    assignedResponder: null,
    verified: true
  };
  
  // Use Indian name if not provided
  if (!data.name) {
    emergency.name = 'Ankit Sharma'; // Default Indian name
  }

  activeEmergencies.set(emergency.id, emergency);
  console.log(`New emergency from ${emergency.name} at ${emergency.location}`);
  return emergency;
}

function notifyResponders(emergency) {
  connectedResponders.forEach((responder, id) => {
    if (responder.status === 'available') {
      responder.ws.send(JSON.stringify({
        type: 'new_emergency',
        data: emergency
      }));
    }
  });
}

function alertNearbyVolunteers(emergency) {
  // Determine radius based on emergency severity
  const radiusKm = {
    'low': 5,
    'medium': 10, 
    'high': 20
  }[emergency.severity] || 10;

  // Find and filter volunteers
  const nearbyVolunteers = findNearbyVolunteers(emergency.coordinates, radiusKm)
    .filter(volunteer => {
      // Match skills to emergency type
      if (emergency.type === 'medical' && 
          !volunteer.skills.some(s => VOLUNTEER_SKILLS.medical.includes(s))) {
        return false;
      }
      if (emergency.type === 'rescue' &&
          !volunteer.skills.some(s => VOLUNTEER_SKILLS.rescue.includes(s))) {
        return false;
      }
      return true;
    });

  // Send localized alerts
  nearbyVolunteers.forEach(volunteer => {
    const alertMessage = {
      type: 'emergency_alert',
      data: {
        ...emergency,
        distance: calculateDistance(
          emergency.coordinates.lat,
          emergency.coordinates.lng,
          volunteer.location.lat,
          volunteer.location.lng
        ).toFixed(1),
        preferredLanguage: volunteer.details.languages[0] || 'en'
      }
    };
    volunteer.ws.send(JSON.stringify(alertMessage));
  });

  console.log(`Alerted ${nearbyVolunteers.length} volunteers for emergency ${emergency.id}`);
}

function findNearbyVolunteers(coords, radiusKm) {
  // Implementation would use haversine formula to calculate distances
  // This is a simplified version for demo purposes
  return Array.from(connectedVolunteers.values())
    .filter(v => v.status === 'available');
}

function handleEmergencyAcceptance(emergencyId, responderId) {
  const emergency = activeEmergencies.get(emergencyId);
  if (emergency) {
    emergency.status = 'accepted';
    emergency.assignedResponder = responderId;
    activeEmergencies.set(emergencyId, emergency);
    
    // Notify all responders
    connectedResponders.forEach(responder => {
      responder.ws.send(JSON.stringify({
        type: 'emergency_update',
        data: emergency
      }));
    });
  }
}

function generateId() {
  return Math.random().toString(36).substring(2, 15);
}

// Calculate distance between two coordinates in kilometers
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * 
    Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function handleVolunteerCompletion(emergencyId, volunteerId) {
  const emergency = activeEmergencies.get(emergencyId);
  if (emergency) {
    // Update volunteer status
    if (connectedVolunteers.has(volunteerId)) {
      connectedVolunteers.get(volunteerId).status = 'available';
    }
    
    // Log completion
    console.log(`Volunteer ${volunteerId} completed response to emergency ${emergencyId}`);
    
    // Notify responders
    connectedResponders.forEach(responder => {
      responder.ws.send(JSON.stringify({
        type: 'volunteer_update',
        emergencyId,
        volunteerId,
        status: 'completed'
      }));
    });
  }
}

function handleVolunteerResponse(emergencyId, volunteerId, response) {
  const emergency = activeEmergencies.get(emergencyId);
  const volunteer = connectedVolunteers.get(volunteerId);

  if (!emergency || !volunteer) {
    return;
  }

  if (response === 'accepted') {
    // Update volunteer status
    volunteer.status = 'responding';
    volunteer.currentEmergency = emergencyId;
    
    // Add to emergency's accepted volunteers
    if (!emergency.acceptedVolunteers) {
      emergency.acceptedVolunteers = [];
    }
    emergency.acceptedVolunteers.push({
      id: volunteerId,
      name: `${volunteer.details.firstName} ${volunteer.details.lastName}`,
      skills: volunteer.skills,
      distance: calculateDistance(
        emergency.coordinates.lat,
        emergency.coordinates.lng,
        volunteer.location.lat,
        volunteer.location.lng
      ).toFixed(1)
    });

    // Notify all responders
    connectedResponders.forEach(responder => {
      responder.ws.send(JSON.stringify({
        type: 'volunteer_response',
        emergencyId,
        volunteerId,
        response: 'accepted',
        volunteerDetails: {
          name: `${volunteer.details.firstName} ${volunteer.details.lastName}`,
          skills: volunteer.skills,
          distance: calculateDistance(
            emergency.coordinates.lat,
            emergency.coordinates.lng,
            volunteer.location.lat,
            volunteer.location.lng
          ).toFixed(1) + ' km',
          phone: volunteer.details.phone
        }
      }));
    });

    // Confirm to volunteer
    volunteer.ws.send(JSON.stringify({
      type: 'response_confirmation',
      emergencyId,
      status: 'accepted',
      responderContact: getResponderContact()
    }));
  } else if (response === 'declined') {
    volunteer.ws.send(JSON.stringify({
      type: 'response_confirmation',
      emergencyId, 
      status: 'declined'
    }));
  }
}

function getResponderContact() {
  // Get first available responder's contact
  for (const responder of connectedResponders.values()) {
    if (responder.status === 'available') {
      return responder.details.phone || 'Emergency Dispatch';
    }
  }
  return 'Emergency Services';
}

// Start server
async function startServer() {
  const port = await findAvailablePort(8000, 9000);
  const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });

  server.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });
}

async function findAvailablePort(min, max) {
  for (let port = min; port <= max; port++) {
    const available = await new Promise(resolve => {
      const tester = net.createServer()
        .once('error', () => resolve(false))
        .once('listening', () => {
          tester.close();
          resolve(true);
        })
        .listen(port);
    });
    if (available) return port;
  }
  throw new Error('No available ports found');
}

// Serve static files
app.use(express.static(path.join(__dirname, '/')));

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});