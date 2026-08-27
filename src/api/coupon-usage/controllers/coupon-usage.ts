import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::coupon-usage.coupon-usage', ({ strapi }) => ({
  async find(ctx) {
    // Support either ?couponId=... or ?couponDocumentId=... from query params
    const couponDocId = ctx.query.couponId || ctx.query.couponDocumentId;

    if (!couponDocId) {
      return ctx.badRequest('Missing required query parameter: couponId');
    }

    const isNumeric = !isNaN(Number(couponDocId));

    const entries = await strapi.documents('api::coupon-usage.coupon-usage').findMany({
      filters: {
        coupon: isNumeric
          ? {
              $or: [
                { documentId: String(couponDocId) },
                { id: Number(couponDocId) },
              ],
            }
          : {
              documentId: String(couponDocId),
            },
      },
      populate: {
        user_profile: true,
      },
      limit: -1,
    });

    // 2. Format response to include requested fields along with orderNo
    const data = await Promise.all(
      (entries || []).map(async (item: any) => {
        let orderNo = item.orderNo || null;

        // Fallback for previous usage records where orderNo wasn't persisted
        if (!orderNo && item.user_profile?.id) {
          const matchedOrder = await strapi.db.query("api::order.order").findOne({
            where: {
              user_profile: item.user_profile.id,
              discount: item.discount_amount,
            },
            select: ["orderNo"],
            orderBy: { createdAt: "desc" },
          });
          if (matchedOrder) {
            orderNo = matchedOrder.orderNo;
          }
        }

        return {
          customer_name:
            item.user_profile?.name ||
            item.user_profile?.fullName ||
            item.user_identifier ||
            null,
          profile_id: item.user_profile?.documentId || item.user_profile?.id || null,
          used_at: item.used_at,
          order_amount: item.order_amount,
          discount_amount: item.discount_amount,
          orderNo,
        };
      })
    );

    return { data };
  },
}));