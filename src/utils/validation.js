/**
 * Validation utilities for form inputs and data
 */

/**
 * Validate zoom percentage input
 * @param {string|number} value - The zoom value to validate
 * @param {number} min - Minimum allowed value (default: 10)
 * @param {number} max - Maximum allowed value (default: 500)
 * @returns {object} - { isValid: boolean, value: number|null, error: string|null }
 */
export function validateZoom(value, min = 10, max = 500) {
  if (value === '' || value === null || value === undefined) {
    return {
      isValid: false,
      value: null,
      error: 'Zoom value is required',
    };
  }

  const numValue = typeof value === 'string' ? parseFloat(value) : value;

  if (isNaN(numValue)) {
    return {
      isValid: false,
      value: null,
      error: 'Zoom must be a valid number',
    };
  }

  if (numValue < min) {
    return {
      isValid: false,
      value: min,
      error: `Zoom must be at least ${min}%`,
    };
  }

  if (numValue > max) {
    return {
      isValid: false,
      value: max,
      error: `Zoom must be at most ${max}%`,
    };
  }

  return {
    isValid: true,
    value: numValue,
    error: null,
  };
}

/**
 * Validate page number input
 * @param {string|number} value - The page number to validate
 * @param {number} min - Minimum page number (default: 1)
 * @param {number} max - Maximum page number (total pages)
 * @returns {object} - { isValid: boolean, value: number|null, error: string|null }
 */
export function validatePageNumber(value, min = 1, max = Infinity) {
  if (value === '' || value === null || value === undefined) {
    return {
      isValid: false,
      value: null,
      error: 'Page number is required',
    };
  }

  const numValue = typeof value === 'string' ? parseInt(value, 10) : value;

  if (isNaN(numValue) || !Number.isInteger(numValue)) {
    return {
      isValid: false,
      value: null,
      error: 'Page number must be a valid integer',
    };
  }

  if (numValue < min) {
    return {
      isValid: false,
      value: min,
      error: `Page number must be at least ${min}`,
    };
  }

  if (numValue > max) {
    return {
      isValid: false,
      value: max,
      error: `Page number must be at most ${max}`,
    };
  }

  return {
    isValid: true,
    value: numValue,
    error: null,
  };
}

/**
 * Check for duplicate names in a list
 * @param {string} name - Name to check
 * @param {array} items - List of items to check against
 * @param {function} getName - Function to extract name from item (default: item => item.name)
 * @param {string} ignoreId - ID to ignore in comparison (for editing)
 * @param {function} getId - Function to extract ID from item (default: item => item.id)
 * @returns {boolean} - true if duplicate exists
 */
export function hasDuplicateName(
  name,
  items,
  getName = (item) => item?.name,
  ignoreId = null,
  getId = (item) => item?.id
) {
  if (!name || typeof name !== 'string') return false;

  const normalizedName = name.trim().toLowerCase();
  if (!normalizedName) return false;

  return items.some((item) => {
    if (!item) return false;
    if (ignoreId !== null && getId(item) === ignoreId) return false;

    const itemName = getName(item);
    if (!itemName || typeof itemName !== 'string') return false;

    return itemName.trim().toLowerCase() === normalizedName;
  });
}

/**
 * Validate file name for export
 * @param {string} fileName - File name to validate
 * @returns {object} - { isValid: boolean, sanitized: string, error: string|null }
 */
export function validateFileName(fileName) {
  if (!fileName || typeof fileName !== 'string') {
    return {
      isValid: false,
      sanitized: '',
      error: 'File name is required',
    };
  }

  const trimmed = fileName.trim();

  if (trimmed.length === 0) {
    return {
      isValid: false,
      sanitized: '',
      error: 'File name cannot be empty',
    };
  }

  // Remove invalid file name characters
  const sanitized = trimmed.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');

  // Check if sanitization removed everything
  if (sanitized.length === 0) {
    return {
      isValid: false,
      sanitized: 'export',
      error: 'File name contains only invalid characters',
    };
  }

  return {
    isValid: true,
    sanitized,
    error: null,
  };
}

/**
 * Validate email address (basic validation)
 * @param {string} email - Email to validate
 * @returns {object} - { isValid: boolean, error: string|null }
 */
export function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    return {
      isValid: false,
      error: 'Email is required',
    };
  }

  const trimmed = email.trim();

  if (trimmed.length === 0) {
    return {
      isValid: false,
      error: 'Email cannot be empty',
    };
  }

  // Basic email regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailRegex.test(trimmed)) {
    return {
      isValid: false,
      error: 'Invalid email format',
    };
  }

  return {
    isValid: true,
    error: null,
  };
}

/**
 * Sanitize and validate text input
 * @param {string} text - Text to validate
 * @param {object} options - Validation options
 * @returns {object} - { isValid: boolean, sanitized: string, error: string|null }
 */
export function validateText(text, options = {}) {
  const {
    required = false,
    minLength = 0,
    maxLength = Infinity,
    allowEmpty = !required,
    trim = true,
  } = options;

  if (!text || typeof text !== 'string') {
    if (required) {
      return {
        isValid: false,
        sanitized: '',
        error: 'This field is required',
      };
    }
    return {
      isValid: true,
      sanitized: '',
      error: null,
    };
  }

  const sanitized = trim ? text.trim() : text;

  if (!allowEmpty && sanitized.length === 0) {
    return {
      isValid: false,
      sanitized: '',
      error: 'This field cannot be empty',
    };
  }

  if (sanitized.length < minLength) {
    return {
      isValid: false,
      sanitized,
      error: `Must be at least ${minLength} characters`,
    };
  }

  if (sanitized.length > maxLength) {
    return {
      isValid: false,
      sanitized: sanitized.substring(0, maxLength),
      error: `Must be at most ${maxLength} characters`,
    };
  }

  return {
    isValid: true,
    sanitized,
    error: null,
  };
}
