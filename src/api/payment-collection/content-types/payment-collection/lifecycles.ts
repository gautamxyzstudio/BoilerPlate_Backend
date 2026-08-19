import { generateUniquePaymentId } from "../../../../utils/generatePaymentId";

export default {
  async afterCreate(event: any) {
    const { result } = event;

    if (result && !result.paymentId) {
      try {
        const paymentId = await generateUniquePaymentId(strapi);

        await strapi.db
          .query("api::payment-collection.payment-collection")
          .update({
            where: { id: result.id },
            data: { paymentId },
          });
      } catch (error) {
        strapi.log.error("Failed to generate paymentId in lifecycle hook:", error);
      }
    }
  },
};
