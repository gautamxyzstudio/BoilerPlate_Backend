/**
 * coupon controller
 */

import { factories } from "@strapi/strapi";

/**
 * Helper to resolve user profile and user identifier from Strapi context,
 * checking ctx.state.user, Bearer token in Authorization header, or explicit userProfileId.
 */
async function resolveUserContext(
  strapi: any,
  ctx: any,
  explicitProfileId?: string,
  explicitIdentifier?: string,
) {
  let user = ctx.state.user;
  let resolvedProfileId = explicitProfileId;

  // If user is not set in ctx.state, try decoding Authorization Bearer header
  if (!user && ctx.headers?.authorization) {
    const authHeader = ctx.headers.authorization;
    if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7).trim();
      try {
        const jwtService = strapi.plugin("users-permissions")?.service("jwt");
        if (jwtService) {
          const decoded = await jwtService.verify(token);
          if (decoded && decoded.id) {
            user = await strapi.db
              .query("plugin::users-permissions.user")
              .findOne({
                where: { id: decoded.id },
                select: ["id", "documentId", "email"],
              });
          }
        }
      } catch (err) {
        // Ignore invalid token so public guest access works smoothly
      }
    }
  }

  // If user profile is not provided, fetch user_profile associated with the logged-in user
  if (!resolvedProfileId && user) {
    const profile = await strapi.db
      .query("api::user-profile.user-profile")
      .findOne({
        where: { users_permissions_user: user.id },
        select: ["documentId"],
      });
    resolvedProfileId = profile?.documentId;
  }

  const userIdentifier =
    explicitIdentifier || (user ? user.id.toString() : undefined);

  return {
    user,
    userProfileId: resolvedProfileId,
    userIdentifier,
  };
}

export default factories.createCoreController(
  "api::coupon.coupon",
  ({ strapi }) => ({
    /**
     * Apply coupon to an order/cart amount
     */
    async apply(ctx) {
      try {
        const body = ctx.request.body?.data || ctx.request.body || {};
        const { code, orderAmount, userProfileId, userIdentifier } = body;

        if (!code || typeof code !== "string") {
          return ctx.badRequest("Coupon code is required.");
        }

        if (
          orderAmount == null ||
          isNaN(Number(orderAmount)) ||
          Number(orderAmount) < 0
        ) {
          return ctx.badRequest("Valid positive orderAmount is required.");
        }

        const {
          userProfileId: resolvedProfileId,
          userIdentifier: resolvedIdentifier,
        } = await resolveUserContext(
          strapi,
          ctx,
          userProfileId,
          userIdentifier,
        );

        const couponService = strapi.service("api::coupon.coupon") as any;

        const result = await couponService.applyCoupon(
          code,
          Number(orderAmount),
          resolvedProfileId,
          resolvedIdentifier,
        );

        console.log(result, "result");

        if ("isValid" in result && !result.isValid) {
          return ctx.badRequest(result.reason || "Coupon cannot be applied.", {
            code: result.code,
            remainingAmount: result.remainingAmount,
            ruleFailed: result.ruleFailed,
          });
        }

        if (result.couponStatus === "INELIGIBLE") {
          return ctx.badRequest(result.reason || "Coupon is not eligible.", {
            code: result.code,
            remainingAmount: result.remainingAmount,
          });
        }

        return ctx.send({
          success: true,
          message: "Coupon applied successfully.",
          data: {
            code: result.code,
            title: result.title,
            description: result.description,
            discountAmount: result.discountAmount,
            originalOrderTotal: result.originalOrderTotal,
            finalPayableAmount: result.finalPayableAmount,
            couponStatus: "APPLIED",
          },
        });
      } catch (error: any) {
        strapi.log.error("Apply Coupon Error:", error);
        return ctx.badRequest(error?.message || "Failed to apply coupon.");
      }
    },

    /**
     * Validate coupon without marking as used (dry run)
     */
    async validate(ctx) {
      try {
        const body =
          ctx.request.body?.data || ctx.request.body || ctx.query || {};
        const { code, orderAmount, userProfileId, userIdentifier } = body;

        if (!code || typeof code !== "string") {
          return ctx.badRequest("Coupon code is required.");
        }

        if (orderAmount == null || isNaN(Number(orderAmount))) {
          return ctx.badRequest("Valid orderAmount is required.");
        }

        const {
          userProfileId: resolvedProfileId,
          userIdentifier: resolvedIdentifier,
        } = await resolveUserContext(
          strapi,
          ctx,
          userProfileId,
          userIdentifier,
        );

        const couponService = strapi.service("api::coupon.coupon") as any;

        const result = await couponService.validateAndCalculate(
          code,
          Number(orderAmount),
          resolvedProfileId,
          resolvedIdentifier,
        );

        if ("isValid" in result && !result.isValid) {
          return ctx.send({
            success: false,
            isEligible: false,
            code: result.code,
            message: result.reason,
            remainingAmount: result.remainingAmount || 0,
          });
        }

        if (result.couponStatus === "INELIGIBLE") {
          return ctx.send({
            success: false,
            isEligible: false,
            code: result.code,
            message: result.reason,
            remainingAmount: result.remainingAmount || 0,
          });
        }

        return ctx.send({
          success: true,
          isEligible: true,
          message: "Coupon is valid and eligible.",
          data: {
            code: result.code,
            title: result.title,
            description: result.description,
            discountAmount: result.discountAmount,
            originalOrderTotal: result.originalOrderTotal,
            finalPayableAmount: result.finalPayableAmount,
            couponStatus: "APPLIED",
          },
        });
      } catch (error: any) {
        strapi.log.error("Validate Coupon Error:", error);
        return ctx.badRequest(error?.message || "Failed to validate coupon.");
      }
    },

    /**
     * Get available coupons with dynamic eligibility status based on user Bearer token or orderAmount
     */
    async getAvailable(ctx) {
      try {
        const orderAmountParam =
          ctx.query.orderAmount || ctx.request.body?.orderAmount || 0;
        const orderAmount = Number(orderAmountParam);
        const userProfileId =
          ctx.query.userProfileId || ctx.request.body?.userProfileId;
        const userIdentifier =
          ctx.query.userIdentifier || ctx.request.body?.userIdentifier;

        const {
          userProfileId: resolvedProfileId,
          userIdentifier: resolvedIdentifier,
        } = await resolveUserContext(
          strapi,
          ctx,
          userProfileId,
          userIdentifier,
        );

        const couponService = strapi.service("api::coupon.coupon") as any;

        const availableCoupons = await couponService.getAvailableCoupons(
          orderAmount,
          resolvedProfileId,
          resolvedIdentifier,
        );

        return ctx.send({
          success: true,
          orderAmount,
          count: availableCoupons.length,
          data: availableCoupons,
        });
      } catch (error: any) {
        strapi.log.error("Get Available Coupons Error:", error);
        return ctx.badRequest(
          error?.message || "Failed to fetch available coupons.",
        );
      }
    },

    /**
     * Endpoint to trigger seeding of default coupons
     */
    async seed(ctx) {
      try {
        const couponService = strapi.service("api::coupon.coupon") as any;
        const result = await couponService.seedDefaultCoupons();
        return ctx.send(result);
      } catch (error: any) {
        strapi.log.error("Seed Coupons Error:", error);
        return ctx.badRequest(error?.message || "Failed to seed coupons.");
      }
    },

    async find(ctx) {
      const data = await strapi.entityService.findMany("api::coupon.coupon", {
        ...ctx.query,
        limit: -1,
      });

      return { data };
    },
  }),
);
