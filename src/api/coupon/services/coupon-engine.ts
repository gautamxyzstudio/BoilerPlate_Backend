/**
 * Extensible Coupon & Promotion Rule Engine
 * Designed using Strategy Pattern for easy addition of new coupon types and rules.
 */

export interface CouponEntity {
  id?: number | string;
  documentId?: string;
  code: string;
  title: string;
  description?: string;
  discount_type: "FLAT" | "PERCENTAGE" | string;
  discount_value: number;
  min_order_amount?: number;
  max_discount_amount?: number | null;
  start_date?: string | Date | null;
  end_date?: string | Date | null;
  usage_limit?: number | null;
  usage_limit_per_user?: number | null;
  used_count?: number;
  is_active?: boolean;
}

export interface ValidationContext {
  orderAmount: number;
  userUsageCount?: number;
  currentDate?: Date;
}

export interface ValidationResult {
  isValid: boolean;
  code: string;
  reason?: string;
  remainingAmount?: number;
  ruleFailed?: string;
}

export interface CalculationResult {
  code: string;
  title: string;
  description?: string;
  discountAmount: number;
  originalOrderTotal: number;
  finalPayableAmount: number;
  couponStatus: "APPLIED" | "INELIGIBLE";
  message?: string;
}

/**
 * Strategy interface for calculating discounts.
 * Easily extendable for future types (e.g. TIERED, BUY_X_GET_Y, FREE_SHIPPING).
 */
export interface IDiscountStrategy {
  type: string;
  calculateDiscount(coupon: CouponEntity, orderTotal: number): number;
}

export class FlatDiscountStrategy implements IDiscountStrategy {
  type = "FLAT";

  calculateDiscount(coupon: CouponEntity, orderTotal: number): number {
    const val = Number(coupon.discount_value || 0);
    const minAmount = Number(coupon.min_order_amount || 0);
    if (orderTotal < minAmount) {
      return 0;
    }
    // Flat discount cannot exceed order total
    return Math.min(orderTotal, val);
  }
}

export class PercentageDiscountStrategy implements IDiscountStrategy {
  type = "PERCENTAGE";

  calculateDiscount(coupon: CouponEntity, orderTotal: number): number {
    const minAmount = Number(coupon.min_order_amount || 0);
    if (orderTotal < minAmount) {
      return 0;
    }

    const pct = Number(coupon.discount_value || 0);
    let discount = (orderTotal * pct) / 100;

    if (coupon.max_discount_amount != null && coupon.max_discount_amount !== undefined) {
      const maxDiscount = Number(coupon.max_discount_amount);
      if (discount > maxDiscount) {
        discount = maxDiscount;
      }
    }

    // Discount cannot exceed order total
    return Math.min(orderTotal, discount);
  }
}

/**
 * Interface for Coupon Validation Rules.
 */
export interface IValidationRule {
  name: string;
  validate(coupon: CouponEntity, context: ValidationContext): ValidationResult | null;
}

export class ActiveStatusRule implements IValidationRule {
  name = "ActiveStatusRule";

  validate(coupon: CouponEntity): ValidationResult | null {
    if (coupon.is_active === false) {
      return {
        isValid: false,
        code: coupon.code,
        reason: "This coupon is currently inactive.",
        ruleFailed: this.name,
      };
    }
    return null;
  }
}

export class DateRangeRule implements IValidationRule {
  name = "DateRangeRule";

  validate(coupon: CouponEntity, context: ValidationContext): ValidationResult | null {
    const now = context.currentDate || new Date();

    if (coupon.start_date) {
      const startDate = new Date(coupon.start_date);
      if (now < startDate) {
        return {
          isValid: false,
          code: coupon.code,
          reason: "This offer is not yet valid.",
          ruleFailed: this.name,
        };
      }
    }

    if (coupon.end_date) {
      const endDate = new Date(coupon.end_date);
      if (now > endDate) {
        return {
          isValid: false,
          code: coupon.code,
          reason: "This coupon has expired.",
          ruleFailed: this.name,
        };
      }
    }

    return null;
  }
}

export class TotalUsageLimitRule implements IValidationRule {
  name = "TotalUsageLimitRule";

  validate(coupon: CouponEntity): ValidationResult | null {
    if (
      coupon.usage_limit != null &&
      coupon.usage_limit !== undefined &&
      (coupon.used_count || 0) >= Number(coupon.usage_limit)
    ) {
      return {
        isValid: false,
        code: coupon.code,
        reason: "This coupon's total usage limit has been reached.",
        ruleFailed: this.name,
      };
    }
    return null;
  }
}

export class PerUserUsageLimitRule implements IValidationRule {
  name = "PerUserUsageLimitRule";

  validate(coupon: CouponEntity, context: ValidationContext): ValidationResult | null {
    // Default limit per user is 1 time
    const userLimit = coupon.usage_limit_per_user != null && coupon.usage_limit_per_user !== undefined
      ? Number(coupon.usage_limit_per_user)
      : 1;

    if (
      context.userUsageCount !== undefined &&
      context.userUsageCount >= userLimit
    ) {
      return {
        isValid: false,
        code: coupon.code,
        reason: "You have already used this coupon.",
        ruleFailed: this.name,
      };
    }
    return null;
  }
}

export class MinOrderAmountRule implements IValidationRule {
  name = "MinOrderAmountRule";

  validate(coupon: CouponEntity, context: ValidationContext): ValidationResult | null {
    const minAmount = Number(coupon.min_order_amount || 0);
    const currentOrder = context.orderAmount || 0;

    if (currentOrder < minAmount) {
      const remainingAmount = Number((minAmount - currentOrder).toFixed(2));
      // Format number nicely (e.g. 50 instead of 50.00 if integer)
      const formattedRemaining = remainingAmount % 1 === 0 ? remainingAmount.toString() : remainingAmount.toFixed(2);

      return {
        isValid: false,
        code: coupon.code,
        remainingAmount,
        reason: `Add ₹${formattedRemaining} more to unlock this offer.`,
        ruleFailed: this.name,
      };
    }

    return null;
  }
}

/**
 * Coupon Engine Registry & Executor
 */
export class CouponEngine {
  private strategies = new Map<string, IDiscountStrategy>();
  private validationRules: IValidationRule[] = [];

  constructor() {
    // Register default strategies
    this.registerStrategy(new FlatDiscountStrategy());
    this.registerStrategy(new PercentageDiscountStrategy());

    // Register default rules in execution order
    this.registerRule(new ActiveStatusRule());
    this.registerRule(new DateRangeRule());
    this.registerRule(new TotalUsageLimitRule());
    this.registerRule(new PerUserUsageLimitRule());
    this.registerRule(new MinOrderAmountRule());
  }

  registerStrategy(strategy: IDiscountStrategy) {
    this.strategies.set(strategy.type.toUpperCase(), strategy);
  }

  registerRule(rule: IValidationRule) {
    this.validationRules.push(rule);
  }

  validateCoupon(coupon: CouponEntity, context: ValidationContext): ValidationResult {
    for (const rule of this.validationRules) {
      const errorResult = rule.validate(coupon, context);
      if (errorResult) {
        return errorResult;
      }
    }

    return {
      isValid: true,
      code: coupon.code,
    };
  }

  calculateDiscount(coupon: CouponEntity, orderAmount: number): number {
    const strategyType = (coupon.discount_type || "FLAT").toUpperCase();
    const strategy = this.strategies.get(strategyType);

    if (!strategy) {
      throw new Error(`Unsupported discount type: ${coupon.discount_type}`);
    }

    const rawDiscount = strategy.calculateDiscount(coupon, orderAmount);
    // Ensure discount is non-negative and bounded by order total
    const roundedDiscount = Number(Math.max(0, rawDiscount).toFixed(2));
    return Math.min(orderAmount, roundedDiscount);
  }

  evaluate(coupon: CouponEntity, context: ValidationContext): CalculationResult | (ValidationResult & { status: "INELIGIBLE" }) {
    const validation = this.validateCoupon(coupon, context);

    if (!validation.isValid) {
      return {
        ...validation,
        status: "INELIGIBLE",
      };
    }

    const discountAmount = this.calculateDiscount(coupon, context.orderAmount);
    const finalPayableAmount = Number(Math.max(0, context.orderAmount - discountAmount).toFixed(2));

    return {
      code: coupon.code,
      title: coupon.title,
      description: coupon.description,
      discountAmount,
      originalOrderTotal: context.orderAmount,
      finalPayableAmount,
      couponStatus: "APPLIED",
      message: "Coupon applied successfully.",
    };
  }
}

// Export singleton instance
export const couponEngine = new CouponEngine();
