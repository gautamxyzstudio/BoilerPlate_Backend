import { factories } from "@strapi/strapi";

const uid = "api::service.service";

export default factories.createCoreController(
    "api::service.service",
    ({ strapi }) => ({

        async create(ctx) {
            const trx = await strapi.db.transaction();

            try {
                const body = ctx.request.body?.data || ctx.request.body;

                const {
                    name,
                    description,
                    image,
                    service_category,
                    estimatedDuration,
                    displayOrder,
                    pricingModel,

                    // Flat pricing
                    price,
                    offerPrice,
                    expressDeliveryPrice,

                    // Variant pricing
                    variants = [],
                } = body;

                // ===========================
                // Validations
                // ===========================

                if (!name) {
                    throw new Error("Service name is required.");
                }

                if (!service_category) {
                    throw new Error("Service category is required.");
                }

                if (!estimatedDuration) {
                    throw new Error("Estimated duration is required.");
                }

                if (!["flat", "variant"].includes(pricingModel)) {
                    throw new Error("Invalid pricing model.");
                }

                if (pricingModel === "flat") {
                    if (!price) {
                        throw new Error("Price is required.");
                    }

                    if (variants.length) {
                        throw new Error(
                            "Variants are not allowed for flat pricing."
                        );
                    }
                }

                if (pricingModel === "variant") {
                    if (price) {
                        throw new Error(
                            "Price should not be sent for variant pricing."
                        );
                    }
                }

                // ===========================
                // Create Service
                // ===========================

                const service = await strapi.documents(uid).create({
                    data: {
                        name,
                        description,
                        image,
                        service_category,
                        estimatedDuration,
                        displayOrder,
                        pricingModel,
                    },
                    transaction: trx,
                });

                // ===========================
                // Flat Pricing
                // ===========================

                if (pricingModel === "flat") {

                    await strapi
                        .documents("api::service-pricing.service-pricing")
                        .create({
                            data: {
                                service: service.documentId,
                                price,
                                offerPrice,
                                expressDeliveryPrice,
                            },
                            transaction: trx,
                        });

                }

                // ===========================
                // Variant Pricing
                // ===========================

                if (
                    pricingModel === "variant" &&
                    variants.length
                ) {

                    for (const variant of variants) {

                        const createdVariant =
                            await strapi.documents(
                                "api::service-varient.service-varient"
                            ).create({
                                data: {
                                    name: variant.name,
                                    image: variant.image,
                                    service: service.documentId,
                                },
                                transaction: trx,
                            });

                        await strapi
                            .documents(
                                "api::service-pricing.service-pricing"
                            )
                            .create({
                                data: {
                                    service_varient:
                                        createdVariant.documentId,
                                    price: variant.price,
                                    offerPrice: variant.offerPrice,
                                    expressDeliveryPrice:
                                        variant.expressDeliveryPrice,
                                },
                                transaction: trx,
                            });

                    }

                }

                await trx.commit();

                const response = await strapi.documents(uid).findOne({
                    documentId: service.documentId,
                    populate:
                        pricingModel === "flat"
                            ? {
                                image: true,
                                service_category: true,
                                service_pricings: true,
                            }
                            : {
                                image: true,
                                service_category: true,
                                service_varients: {
                                    populate: {
                                        image: true,
                                        service_pricings: true,
                                    },
                                },
                            },
                });

                return {
                    data: response,
                    message: "Service created successfully.",
                };

            } catch (error) {
                await trx.rollback();

                const message =
                    error instanceof Error
                        ? error.message
                        : "Unable to create service.";

                return ctx.badRequest(message);
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