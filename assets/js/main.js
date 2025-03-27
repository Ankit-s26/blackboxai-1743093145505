/**
 * Main utility functions for the Emergency Response Network
 */

// Initialize all tooltips on the page
function initTooltips() {
    const tooltipElements = document.querySelectorAll('[data-tooltip]');
    tooltipElements.forEach(el => {
        const tooltipText = el.getAttribute('data-tooltip');
        el.addEventListener('mouseenter', () => showTooltip(el, tooltipText));
        el.addEventListener('mouseleave', hideTooltip);
    });
}

// Show a tooltip near the element
function showTooltip(element, text) {
    const tooltip = document.createElement('div');
    tooltip.className = 'absolute z-50 px-2 py-1 text-sm text-white bg-gray-900 rounded-md shadow-lg';
    tooltip.textContent = text;
    
    const rect = element.getBoundingClientRect();
    tooltip.style.top = `${rect.bottom + window.scrollY + 5}px`;
    tooltip.style.left = `${rect.left + window.scrollX}px`;
    
    tooltip.id = 'current-tooltip';
    document.body.appendChild(tooltip);
}

// Hide the current tooltip
function hideTooltip() {
    const tooltip = document.getElementById('current-tooltip');
    if (tooltip) {
        tooltip.remove();
    }
}

// Format phone number as user types
function formatPhoneNumber(input) {
    // Strip all characters except digits
    let phone = input.value.replace(/\D/g, '');
    
    // Format as +1 (XXX) XXX-XXXX
    if (phone.length > 0) {
        phone = `+1 (${phone.substring(0, 3)}) ${phone.substring(3, 6)}-${phone.substring(6, 10)}`;
    }
    
    input.value = phone;
}

// Initialize phone number formatting
function initPhoneFormatting() {
    const phoneInputs = document.querySelectorAll('input[type="tel"]');
    phoneInputs.forEach(input => {
        input.addEventListener('input', () => formatPhoneNumber(input));
    });
}

// Toggle mobile menu visibility
function toggleMobileMenu() {
    const menu = document.getElementById('mobile-menu');
    menu.classList.toggle('hidden');
}

// Initialize all event listeners when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initTooltips();
    initPhoneFormatting();
    
    // Add click event for mobile menu button if it exists
    const mobileMenuButton = document.getElementById('mobile-menu-button');
    if (mobileMenuButton) {
        mobileMenuButton.addEventListener('click', toggleMobileMenu);
    }
    
    // Initialize form validation
    const forms = document.querySelectorAll('form');
    forms.forEach(form => {
        form.addEventListener('submit', (e) => {
            if (!form.checkValidity()) {
                e.preventDefault();
                // Add visual feedback for invalid fields
                const invalidFields = form.querySelectorAll(':invalid');
                invalidFields.forEach(field => {
                    field.classList.add('border-red-500');
                    field.addEventListener('input', () => {
                        if (field.checkValidity()) {
                            field.classList.remove('border-red-500');
                        }
                    });
                });
                
                // Scroll to first invalid field
                invalidFields[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });
    });
});

// Debounce function for performance optimization
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Throttle function for scroll/resize events
function throttle(func, limit) {
    let lastFunc;
    let lastRan;
    return function() {
        const context = this;
        const args = arguments;
        if (!lastRan) {
            func.apply(context, args);
            lastRan = Date.now();
        } else {
            clearTimeout(lastFunc);
            lastFunc = setTimeout(function() {
                if ((Date.now() - lastRan) >= limit) {
                    func.apply(context, args);
                    lastRan = Date.now();
                }
            }, limit - (Date.now() - lastRan));
        }
    };
}