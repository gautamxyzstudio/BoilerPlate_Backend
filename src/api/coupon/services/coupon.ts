/**
 * coupon service
 */

import { factories } from "@strapi/strapi";
import { couponEngine, CalculationResult, ValidationResult } from "./coupon-engine";

export default factories.createCoreService("api::coupon.coupon", ({ strapi }) => ({
  /**
   * Helper to count how many times a user has used a specific coupon
   */
  async getUserCouponUsageCount(couponDbId: number, userProfileId?: string, userIdentifier?: string): Promise<number> {
    if (!userProfileId && !userIdentifier) {
      return 0;
    }

    const filters: any = {
      coupon: { id: couponDbId },
    };

    if (userProfileId && userIdentifier) {
      filters.$or = [
        { user_profile: { documentId: userProfileId } },
        { user_identifier: userIdentifier },
      ];
    } else if (userProfileId) {
      filters.user_profile = { documentId: userProfileId };
    } else if (userIdentifier) {
      filters.user_identifier = userIdentifier;
    }

    const usages = await strapi.documents("api::coupon-usage.coupon-usage").findMany({
      filters,
    });

    return usages.length;
  },

  /**
   * Validates a coupon code against order amount and user, returns calculation or eligibility reason
   */
  async validateAndCalculate(code: string, orderAmount: number, userProfileId?: string, userIdentifier?: string) {
    const formattedCode = code.trim().toUpperCase();

    // 1. Find coupon by code
    const coupon: any = await strapi.documents("api::coupon.coupon").findFirst({
      filters: {
        code: { $eqi: formattedCode },
      } as any,
    });

    if (!coupon) {
      return {
        isValid: false,
        code: formattedCode,
        status: "INELIGIBLE",
        reason: `Coupon code '${formattedCode}' does not exist.`,
      };
    }

    // 2. Fetch DB ID for relational usage query
    const couponDbRecord = await strapi.db.query("api::coupon.coupon").findOne({
      where: { documentId: coupon.documentId },
      select: ["id"],
    });

    const couponDbId = couponDbRecord?.id;

    // 3. Fetch user usage count
    const userUsageCount = couponDbId
      ? await this.getUserCouponUsageCount(couponDbId, userProfileId, userIdentifier)
      : 0;

    // 4. Run rule engine evaluation
    const evaluation = couponEngine.evaluate(coupon, {
      orderAmount: Number(orderAmount),
      userUsageCount,
      currentDate: new Date(),
    });

    return {
      coupon,
      ...evaluation,
    };
  },

  /**
   * Applies coupon, creates a coupon redemption usage record, and increments used_count
   */
  async applyCoupon(code: string, orderAmount: number, userProfileId?: string, userIdentifier?: string) {
    const result = await this.validateAndCalculate(code, orderAmount, userProfileId, userIdentifier);

    if ("isValid" in result && !result.isValid) {
      return result;
    }

    const evalStatus = (result as any).couponStatus || (result as any).status;
    if (evalStatus !== "APPLIED") {
      return result;
    }

    const coupon = (result as any).coupon;

    // Increment used_count on coupon
    const newUsedCount = Number(coupon.used_count || 0) + 1;
    await strapi.documents("api::coupon.coupon").update({
      documentId: coupon.documentId,
      data: {
        used_count: newUsedCount,
      } as any,
    });

    // Create coupon usage record
    const couponDbRecord = await strapi.db.query("api::coupon.coupon").findOne({
      where: { documentId: coupon.documentId },
      select: ["id"],
    });

    await strapi.documents("api::coupon-usage.coupon-usage").create({
      data: {
        coupon: couponDbRecord?.id,
        user_profile: userProfileId || null,
        user_identifier: userIdentifier || "guest",
        discount_amount: (result as any).discountAmount,
        order_amount: orderAmount,
        used_at: new Date().toISOString(),
      } as any,
    });

    return {
      code: (result as any).code,
      title: (result as any).title,
      description: (result as any).description,
      discountAmount: (result as any).discountAmount,
      originalOrderTotal: (result as any).originalOrderTotal,
      finalPayableAmount: (result as any).finalPayableAmount,
      couponStatus: "APPLIED",
      message: (result as any).message || "Coupon applied successfully.",
    };
  },

  /**
   * Lists all active coupons with dynamic eligibility status based on orderAmount & user
   */
  async getAvailableCoupons(orderAmount: number, userProfileId?: string, userIdentifier?: string) {
    const coupons: any[] = await strapi.documents("api::coupon.coupon").findMany({
      filters: {
        is_active: { $eq: true },
      } as any,
      sort: ["min_order_amount:asc", "createdAt:desc"] as any,
    });

    const evaluatedCoupons = await Promise.all(
      coupons.map(async (coupon) => {
        const couponDbRecord = await strapi.db.query("api::coupon.coupon").findOne({
          where: { documentId: coupon.documentId },
          select: ["id"],
        });

        const userUsageCount = couponDbRecord?.id
          ? await this.getUserCouponUsageCount(couponDbRecord.id, userProfileId, userIdentifier)
          : 0;

        const evalResult: any = couponEngine.evaluate(coupon, {
          orderAmount: Number(orderAmount),
          userUsageCount,
          currentDate: new Date(),
        });

        const minAmount = Number(coupon.min_order_amount || 0);
        const maxDiscount = coupon.max_discount_amount != null ? Number(coupon.max_discount_amount) : null;
        const discountVal = Number(coupon.discount_value || 0);
        const isApplied = evalResult.couponStatus === "APPLIED";

        return {
          id: coupon.id,
          documentId: coupon.documentId,
          code: coupon.code,
          title: coupon.title,
          description: coupon.description,
          discount_type: coupon.discount_type,
          discount_value: discountVal,
          min_order_amount: minAmount,
          max_discount_amount: maxDiscount,
          start_date: coupon.start_date,
          end_date: coupon.end_date,
          usage_limit: coupon.usage_limit,
          usage_limit_per_user: coupon.usage_limit_per_user,
          used_count: coupon.used_count,
          is_active: coupon.is_active,
          // Dynamic calculation fields
          isEligible: isApplied,
          discountAmount: isApplied ? evalResult.discountAmount : 0,
          remainingAmount: evalResult.remainingAmount || 0,
          statusMessage: isApplied
            ? `Save ₹${evalResult.discountAmount} on this order!`
            : evalResult.reason || "Not eligible",
          evaluation: evalResult,
        };
      })
    );

    return evaluatedCoupons;
  },

  /**
   * Seeds example default coupons if they do not exist
   */
  async seedDefaultCoupons() {
    const existingCount = await strapi.documents("api::coupon.coupon").count({});

    if (existingCount > 0) {
      strapi.log.info("Coupons already seeded in database.");
      return { message: "Coupons already exist." };
    }

    const defaultCoupons: any[] = [
      {
        code: "SAVE20",
        title: "Flat ₹20 OFF",
        description: "Get ₹20 off on orders above ₹100",
        discount_type: "FLAT",
        discount_value: 20,
        min_order_amount: 100,
        max_discount_amount: null,
        usage_limit_per_user: 1,
        used_count: 0,
        is_active: true,
      },
      {
        code: "WASH10",
        title: "10% OFF up to ₹50",
        description: "Get 10% off on orders above ₹200",
        discount_type: "PERCENTAGE",
        discount_value: 10,
        min_order_amount: 200,
        max_discount_amount: 50,
        usage_limit_per_user: 1,
        used_count: 0,
        is_active: true,
      },
      {
        code: "WELCOME50",
        title: "Flat ₹50 OFF Mega Saver",
        description: "Get ₹50 off on orders above ₹300",
        discount_type: "FLAT",
        discount_value: 50,
        min_order_amount: 300,
        max_discount_amount: null,
        usage_limit_per_user: 1,
        used_count: 0,
        is_active: true,
      },
    ];

    const created: any[] = [];
    for (const data of defaultCoupons) {
      const coupon = await strapi.documents("api::coupon.coupon").create({ data });
      created.push(coupon);
    }

    strapi.log.info(`Seeded ${created.length} default laundry coupons.`);
    return { message: `Seeded ${created.length} default coupons.`, data: created };
  },
}));
