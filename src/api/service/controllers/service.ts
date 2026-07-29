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

        async find(ctx) {
            try {
                const services = await strapi.documents("api::service.service").findMany({
                    ...ctx.query,
                    populate: {
                        image: true,
                        service_category: true,
                        service_pricings: true,
                    },
                });

                ctx.body = {
                    data: services,
                };
            } catch (error: any) {
                strapi.log.error("Error fetching services:", error);

                return ctx.badRequest(
                    error?.message || "Failed to fetch services."
                );
            }
        },

        async findOne(ctx) {
            try {
                const { id } = ctx.params;

                const service = await strapi.documents("api::service.service").findFirst({
                    filters: {
                        id: {
                            $eq: Number(id),
                        },
                    },
                    populate: {
                        image: true,
                        service_category: true,
                        service_pricings: true,
                    },
                });

                if (!service) {
                    return ctx.notFound("Service not found.");
                }

                ctx.body = {
                    data: service,
                };
            } catch (error: any) {
                strapi.log.error("Error fetching service:", error);
                return ctx.badRequest(error.message);
            }
        },

        async update(ctx) {
            try {
                const { id } = ctx.params;
                const body = ctx.request.body?.data || ctx.request.body || {};

                const {
                    price,
                    offerPrice,
                    expressDeliveryPrice,
                    image,
                    ...serviceData
                } = body;

                // Find the service
                const existingService = await strapi.documents("api::service.service" as any).findFirst({
                    filters: {
                        id: {
                            $eq: Number(id),
                        },
                    },
                    populate: {
                        service_pricings: true,
                    },
                });

                if (!existingService) {
                    return ctx.notFound("Service not found.");
                }

                // Update Service
                await strapi.documents("api::service.service").update({
                    documentId: existingService.documentId,
                    data: {
                        ...serviceData,
                        ...(image !== undefined ? { image } : {}),
                    },
                });

                // Update Service Pricing
                if (existingService.service_pricings?.length > 0) {
                    const pricing = existingService.service_pricings[0];

                    await strapi.documents("api::service-pricing.service-pricing").update({
                        documentId: pricing.documentId,
                        data: {
                            ...(price !== undefined ? { price } : {}),
                            ...(offerPrice !== undefined ? { offerPrice } : {}),
                            ...(expressDeliveryPrice !== undefined
                                ? { expressDeliveryPrice }
                                : {}),
                        },
                    });
                }

                // Return updated service
                const updatedService = await strapi.documents("api::service.service").findOne({
                    documentId: existingService.documentId,
                    populate: {
                        image: true,
                        service_category: true,
                        service_pricings: true,
                    },
                });

                ctx.body = {
                    data: updatedService,
                    message: "Service updated successfully.",
                };
            } catch (error: any) {
                strapi.log.error("Error updating service:", error);
                return ctx.badRequest(error.message);
            }
        },

        async delete(ctx) {
            try {
                const { id } = ctx.params;

                // Find the service
                const service = await strapi.documents("api::service.service").findFirst({
                    filters: {
                        id: {
                            $eq: Number(id),
                        },
                    },
                    populate: {
                        service_pricings: true,
                    },
                });

                if (!service) {
                    return ctx.notFound("Service not found.");
                }

                // Delete all related service pricings
                if (service.service_pricings?.length) {
                    for (const pricing of service.service_pricings) {
                        await strapi.documents("api::service-pricing.service-pricing").delete({
                            documentId: pricing.documentId,
                        });
                    }
                }

                // Delete the service
                await strapi.documents("api::service.service").delete({
                    documentId: service.documentId,
                });

                ctx.body = {
                    message: "Service deleted successfully.",
                };
            } catch (error: any) {
                strapi.log.error("Error deleting service:", error);

                return ctx.badRequest(
                    error?.message || "Failed to delete service."
                );
            }
        }
    })
);