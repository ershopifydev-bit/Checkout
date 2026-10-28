/**
 * Strict money and financial arithmetic utilities for Tezvix.
 *
 * NON-NEGOTIABLE FINANCIAL RULES:
 * 1. Minor units (paise) are integers only.
 * 2. Reject NaN, Infinity, negative values (where unexpected), fractional minor units, and unsafe integers.
 * 3. Never silently replace invalid numbers with zero.
 * 4. Perform all internal calculations in integer minor units. Convert to decimal string only for Shopify GraphQL inputs.
 */

export type CurrencyCode = 'INR';

export type MoneyMinor = {
  amountMinor: number;
  currency: CurrencyCode;
};

export type ShopifyMoneyAmount = {
  amount: string;
  currencyCode: CurrencyCode;
};

export class InvalidMoneyError extends Error {
  constructor(
    message: string,
    public readonly value?: unknown,
  ) {
    super(`[InvalidMoney] ${message}${value !== undefined ? ` (received: ${String(value)})` : ''}`);
    this.name = 'InvalidMoneyError';
  }
}

/**
 * Validates that an amount in minor units is a safe, non-negative integer.
 */
export function validateMinorUnits(
  amountMinor: unknown,
  fieldName = 'amountMinor',
  allowZero = true,
): number {
  if (typeof amountMinor !== 'number') {
    throw new InvalidMoneyError(`Expected ${fieldName} to be a number`, amountMinor);
  }
  if (!Number.isFinite(amountMinor) || Number.isNaN(amountMinor)) {
    throw new InvalidMoneyError(`${fieldName} must be a finite number`, amountMinor);
  }
  if (!Number.isSafeInteger(amountMinor)) {
    throw new InvalidMoneyError(`${fieldName} must be a safe integer`, amountMinor);
  }
  if (Math.floor(amountMinor) !== amountMinor) {
    throw new InvalidMoneyError(
      `${fieldName} must not contain fractional minor units`,
      amountMinor,
    );
  }
  if (amountMinor < 0) {
    throw new InvalidMoneyError(`${fieldName} cannot be negative`, amountMinor);
  }
  if (!allowZero && amountMinor === 0) {
    throw new InvalidMoneyError(`${fieldName} must be greater than zero`, amountMinor);
  }
  return amountMinor;
}

/**
 * Converts integer minor units to Shopify decimal string (e.g. 349900 -> "3499.00").
 */
export function minorToDecimalString(
  amountMinor: unknown,
  fieldName = 'amountMinor',
  allowZero = true,
): string {
  const valid = validateMinorUnits(amountMinor, fieldName, allowZero);
  const rupees = Math.floor(valid / 100);
  const paise = valid % 100;
  return `${rupees}.${paise.toString().padStart(2, '0')}`;
}

/**
 * Converts a Shopify decimal string (e.g. "3499.00" or "3499") to integer minor units.
 */
export function decimalStringToMinor(decimalString: unknown, fieldName = 'decimalString'): number {
  if (typeof decimalString !== 'string' || !decimalString.trim()) {
    throw new InvalidMoneyError(`Expected ${fieldName} to be a non-empty string`, decimalString);
  }
  const clean = decimalString.trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(clean);
  if (!match) {
    throw new InvalidMoneyError(
      `${fieldName} must be a valid positive decimal string`,
      decimalString,
    );
  }
  const whole = Number(match[1]);
  if (!Number.isSafeInteger(whole)) {
    throw new InvalidMoneyError(`${fieldName} exceeds safe integer limits`, decimalString);
  }
  const fractionStr = (match[2] || '').padEnd(2, '0');
  const fraction = Number(fractionStr);
  const totalMinor = whole * 100 + fraction;
  return validateMinorUnits(totalMinor, fieldName);
}

/**
 * Constructs a typed Shopify money object.
 */
export function toShopifyMoney(
  amountMinor: unknown,
  currency: CurrencyCode = 'INR',
  fieldName = 'amountMinor',
): ShopifyMoneyAmount {
  return {
    amount: minorToDecimalString(amountMinor, fieldName),
    currencyCode: currency,
  };
}

/**
 * Safe integer additions of minor units.
 */
export function addMinor(...amounts: number[]): number {
  let sum = 0;
  for (const amt of amounts) {
    validateMinorUnits(amt);
    sum += amt;
    if (!Number.isSafeInteger(sum)) {
      throw new InvalidMoneyError('Sum exceeded safe integer limits');
    }
  }
  return sum;
}

/**
 * Safe integer subtraction of minor units (floor at zero).
 */
export function subMinor(base: number, deduction: number): number {
  validateMinorUnits(base, 'base');
  validateMinorUnits(deduction, 'deduction');
  return Math.max(0, base - deduction);
}

/**
 * Formats minor units for Indian display (e.g. 349900 -> "₹3,499.00").
 */
export function formatInrDisplay(amountMinor: number, showDecimals = true): string {
  const valid = validateMinorUnits(amountMinor);
  const major = valid / 100;
  return `₹${major.toLocaleString('en-IN', {
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}
