import { factories } from "@strapi/strapi";

export default factories.createCoreController(
  "api::service.service",
  ({ strapi }) => ({
    async create(ctx) {
      try {
        const body = ctx.request.body?.data || ctx.request.body || {};

        const {
          price,
          offerPrice,
          expressDeliveryPrice,
          image,
          ...serviceData
        } = body;

        // Validate required price
        if (price === undefined || price === null) {
          return ctx.badRequest("Price is required.");
        }

        // Create Service
        const service = await strapi.documents("api::service.service").create({
          data: {
            ...serviceData,
            ...(image ? { image } : {}),
          },
        });

        // Create Service Pricing
        await strapi.documents("api::service-pricing.service-pricing").create({
          data: {
            service: service.documentId,
            price,
            offerPrice: offerPrice ?? null,
            expressDeliveryPrice: expressDeliveryPrice ?? null,
            isActive: true,
          },
        });

        // Fetch populated service
        const createdService = await strapi.documents("api::service.service").findOne({
          documentId: service.documentId,
          populate: {
            image: true,
            service_category: true,
            service_pricings: true,
          },
        });

        ctx.body = {
          data: createdService,
          message: "Service created successfully.",
        };
      } catch (error: any) {
        strapi.log.error(error);

        return ctx.badRequest(
          error?.message || "Failed to create service."
        );
      }
    },
  })
);