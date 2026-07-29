import { factories } from "@strapi/strapi";

export default factories.createCoreController(
  "api::garment-type.garment-type",
  ({ strapi }) => ({
    /**
     * Create Garment Type
     */
    async create(ctx) {
      try {
        const body = ctx.request.body?.data || ctx.request.body || {};

        const {
          price,
          offerPrice,
          expressDeliveryPrice,
          image,
          ...garmentData
        } = body;

        if (price === undefined || price === null) {
          return ctx.badRequest("Price is required.");
        }

        // Create Garment Type
        const garment = await strapi
          .documents("api::garment-type.garment-type")
          .create({
            data: {
              ...garmentData,
              ...(image ? { image } : {}),
              publishedAt:new Date()
            },
          });

        // Create Pricing
        await strapi
          .documents("api::service-pricing.service-pricing")
          .create({
            data: {
              garment_type: garment.documentId,
              price,
              offerPrice: offerPrice ?? null,
              expressDeliveryPrice: expressDeliveryPrice ?? null,
              isActive: true,
              publishedAt:new Date()
            },
          });

        // Return populated garment
        const createdGarment = await strapi
          .documents("api::garment-type.garment-type")
          .findOne({
            documentId: garment.documentId,
            populate: {
              image: true,
              service: true,
              service_pricings: true,
            },
          });

        ctx.body = {
          data: createdGarment,
          message: "Garment type created successfully.",
        };
      } catch (error: any) {
        strapi.log.error("Error creating garment type:", error);

        return ctx.badRequest(
          error?.message || "Failed to create garment type."
        );
      }
    },

    /**
     * Get All Garment Types
     */
    async find(ctx) {
      try {
        const garments = await strapi
          .documents("api::garment-type.garment-type")
          .findMany({
            ...ctx.query,
            populate: {
              image: true,
              service: true,
              service_pricings: true,
            },
          });

        ctx.body = {
          data: garments,
        };
      } catch (error: any) {
        strapi.log.error("Error fetching garment types:", error);

        return ctx.badRequest(
          error?.message || "Failed to fetch garment types."
        );
      }
    },

    /**
     * Get Single Garment Type
     */
    async findOne(ctx) {
      try {
        const { id } = ctx.params;

        const garment = await strapi
          .documents("api::garment-type.garment-type")
          .findFirst({
            filters: {
              id: {
                $eq: Number(id),
              },
            },
            populate: {
              image: true,
              service: true,
              service_pricings: true,
            },
          });

        if (!garment) {
          return ctx.notFound("Garment type not found.");
        }

        ctx.body = {
          data: garment,
        };
      } catch (error: any) {
        strapi.log.error("Error fetching garment type:", error);

        return ctx.badRequest(
          error?.message || "Failed to fetch garment type."
        );
      }
    },

        /**
     * Update Garment Type
     */
    async update(ctx) {
      try {
        const { id } = ctx.params;
        const body = ctx.request.body?.data || ctx.request.body || {};

        const {
          price,
          offerPrice,
          expressDeliveryPrice,
          image,
          ...garmentData
        } = body;

        // Find garment type
        const existingGarment = await strapi
          .documents("api::garment-type.garment-type" as any)
          .findFirst({
            filters: {
              id: {
                $eq: Number(id),
              },
            },
            populate: {
              service_pricings: true,
            },
          });

        if (!existingGarment) {
          return ctx.notFound("Garment type not found.");
        }

        // Update garment type
        await strapi
          .documents("api::garment-type.garment-type")
          .update({
            documentId: existingGarment.documentId,
            data: {
              ...garmentData,
              ...(image !== undefined ? { image } : {}),
            },
          });

        // Update pricing
        if (existingGarment.service_pricings?.length > 0) {
          const pricing = existingGarment.service_pricings[0];

          await strapi
            .documents("api::service-pricing.service-pricing")
            .update({
              documentId: pricing.documentId,
              data: {
                ...(price !== undefined ? { price } : {}),
                ...(offerPrice !== undefined
                  ? { offerPrice }
                  : {}),
                ...(expressDeliveryPrice !== undefined
                  ? { expressDeliveryPrice }
                  : {}),
              },
            });
        }

        // Return updated garment
        const updatedGarment = await strapi
          .documents("api::garment-type.garment-type")
          .findOne({
            documentId: existingGarment.documentId,
            populate: {
              image: true,
              service: true,
              service_pricings: true,
            },
          });

        ctx.body = {
          data: updatedGarment,
          message: "Garment type updated successfully.",
        };
      } catch (error: any) {
        strapi.log.error("Error updating garment type:", error);

        return ctx.badRequest(
          error?.message || "Failed to update garment type."
        );
      }
    },

    /**
     * Delete Garment Type
     */
    async delete(ctx) {
      try {
        const { id } = ctx.params;

        // Find garment type
        const garment = await strapi
          .documents("api::garment-type.garment-type")
          .findFirst({
            filters: {
              id: {
                $eq: Number(id),
              },
            },
            populate: {
              service_pricings: true,
            },
          });

        if (!garment) {
          return ctx.notFound("Garment type not found.");
        }

        // Delete all related pricing records
        if (garment.service_pricings?.length) {
          for (const pricing of garment.service_pricings) {
            await strapi
              .documents("api::service-pricing.service-pricing")
              .delete({
                documentId: pricing.documentId,
              });
          }
        }

        // Delete garment type
        await strapi
          .documents("api::garment-type.garment-type")
          .delete({
            documentId: garment.documentId,
          });

        ctx.body = {
          message: "Garment type deleted successfully.",
        };
      } catch (error: any) {
        strapi.log.error("Error deleting garment type:", error);

        return ctx.badRequest(
          error?.message || "Failed to delete garment type."
        );
      }
    },
  })
);