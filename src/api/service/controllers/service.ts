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
                    scheduleType,

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

                if (estimatedDuration == null) {
                    throw new Error("Estimated duration is required.");
                }

                if (!["flat", "variant"].includes(pricingModel)) {
                    throw new Error("Invalid pricing model.");
                }

                if (!scheduleType) {
                    throw new Error("Schedule type is required.");
                }

                if (!["pickup_delivery", "appointment"].includes(scheduleType)) {
                    throw new Error("Invalid schedule type.");
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
                        scheduleType,
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
                                    expressDeliveryAvailable:
                                        variant.expressDeliveryAvailable ?? true,
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
                });

                const populatedServices = await Promise.all(
                    services.map((service) =>
                        strapi.documents("api::service.service").findOne({
                            documentId: service.documentId,
                            populate:
                                service.pricingModel === "flat"
                                    ? {
                                        // image: true,
                                        service_category: true,
                                        // service_pricings: true,
                                    }
                                    : {
                                        // image: true,
                                        service_category: true,
                                        // service_varients: {
                                        //     populate: {
                                        //         image: true,
                                        // service_pricings: true,
                                        //     },
                                        // },
                                    },
                        })
                    )
                );

                ctx.body = {
                    data: populatedServices,
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

                const service = await strapi.documents("api::service.service").findOne({
                    documentId: id,
                });

                if (!service) {
                    return ctx.notFound("Service not found.");
                }

                const response = await strapi.documents("api::service.service").findOne({
                    documentId: service.documentId,
                    populate:
                        service.pricingModel === "flat"
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

                ctx.body = {
                    data: response,
                };
            } catch (error: any) {
                strapi.log.error("Error fetching service:", error);
                return ctx.badRequest(
                    error?.message || "Failed to fetch service."
                );
            }
        },

        async update(ctx) {
            const trx = await strapi.db.transaction();

            try {
                const documentId = ctx.params.id;
                const body = ctx.request.body?.data || ctx.request.body;

                const {
                    name,
                    description,
                    image,
                    service_category,
                    estimatedDuration,
                    displayOrder,
                    pricingModel,
                    scheduleType,

                    // Flat Pricing
                    price,
                    offerPrice,
                    expressDeliveryPrice,

                    // Variant Pricing
                    variants = [],
                } = body;

                // ===========================
                // Find Existing Service
                // ===========================

                const existingService = await strapi.documents(uid).findOne({
                    documentId,
                    populate: {
                        image: true,
                        service_category: true,
                        service_pricings: true,
                        service_varients: {
                            populate: {
                                image: true,
                                service_pricings: true,
                            },
                        },
                    },
                });

                if (!existingService) {
                    throw new Error("Service not found.");
                }

                // ===========================
                // Validations
                // ===========================

                if (pricingModel && !["flat", "variant"].includes(pricingModel)) {
                    throw new Error("Invalid pricing model.");
                }

                if (
                    scheduleType &&
                    !["pickup_delivery", "appointment"].includes(scheduleType)
                ) {
                    throw new Error("Invalid schedule type.");
                }

                const finalPricingModel =
                    pricingModel || existingService.pricingModel;

                if (finalPricingModel === "flat") {
                    if (variants.length) {
                        throw new Error(
                            "Variants are not allowed for flat pricing."
                        );

                    }

                    if (
                        finalPricingModel === "flat" &&
                        existingService.pricingModel === "variant" &&
                        price === undefined
                    ) {
                        throw new Error(
                            "Price is required when converting a variant service to flat."
                        );
                    }
                }

                if (
                    finalPricingModel === "variant" &&
                    existingService.pricingModel === "flat" &&
                    variants.length === 0
                ) {
                    throw new Error(
                        "At least one variant is required when converting a flat service to variant."
                    );
                }

                // ===========================
                // Update Service
                // ===========================

                const updated = await strapi.documents(uid).update({
                    documentId: existingService.documentId,
                    data: {
                        ...(name !== undefined && { name }),
                        ...(description !== undefined && {
                            description,
                        }),
                        ...(image !== undefined && { image }),
                        ...(service_category !== undefined && {
                            service_category,
                        }),
                        ...(estimatedDuration !== undefined && {
                            estimatedDuration,
                        }),
                        ...(displayOrder !== undefined && {
                            displayOrder,
                        }),
                        ...(pricingModel !== undefined && {
                            pricingModel,
                        }),
                        ...(scheduleType !== undefined && {
                            scheduleType,
                        }),
                    },
                    transaction: trx,
                });

                if (!updated) {
                    throw new Error("Unable to update service.");
                }

                // ===========================
                // Flat Pricing
                // ===========================

                if (finalPricingModel === "flat") {

                    // ------------------------------------
                    // Variant -> Flat
                    // ------------------------------------

                    if (existingService.pricingModel === "variant") {

                        // Delete Variant Pricing
                        for (const variant of existingService.service_varients || []) {

                            for (const pricing of variant.service_pricings || []) {

                                await strapi
                                    .documents("api::service-pricing.service-pricing")
                                    .delete({
                                        documentId: pricing.documentId,
                                        transaction: trx,
                                    });

                            }

                            // Delete Variant
                            await strapi
                                .documents("api::service-varient.service-varient")
                                .delete({
                                    documentId: variant.documentId,
                                    transaction: trx,
                                });

                        }

                        // Create Flat Pricing
                        await strapi
                            .documents("api::service-pricing.service-pricing")
                            .create({
                                data: {
                                    service: existingService.documentId,
                                    price,
                                    offerPrice,
                                    expressDeliveryPrice,
                                },
                                transaction: trx,
                            });

                    }

                    // ------------------------------------
                    // Flat -> Flat
                    // ------------------------------------

                    else {

                        const existingPricing =
                            existingService.service_pricings?.[0];

                        if (existingPricing) {

                            await strapi
                                .documents("api::service-pricing.service-pricing")
                                .update({
                                    documentId: existingPricing.documentId,
                                    data: {
                                        ...(price !== undefined && {
                                            price,
                                        }),
                                        ...(offerPrice !== undefined && {
                                            offerPrice,
                                        }),
                                        ...(expressDeliveryPrice !== undefined && {
                                            expressDeliveryPrice,
                                        }),
                                    },
                                    transaction: trx,
                                });

                        } else {

                            await strapi
                                .documents("api::service-pricing.service-pricing")
                                .create({
                                    data: {
                                        service: existingService.documentId,
                                        price,
                                        offerPrice,
                                        expressDeliveryPrice,
                                    },
                                    transaction: trx,
                                });

                        }

                    }

                }


                // ===========================
                // Variant Pricing
                // ===========================

                if (finalPricingModel === "variant") {

                    // ------------------------------------
                    // Flat -> Variant
                    // ------------------------------------

                    if (existingService.pricingModel === "flat") {

                        // Delete Flat Pricing
                        for (const pricing of existingService.service_pricings || []) {
                            await strapi
                                .documents("api::service-pricing.service-pricing")
                                .delete({
                                    documentId: pricing.documentId,
                                    transaction: trx,
                                });
                        }

                        // Create Variants + Pricing



                        for (const variant of variants) {

                            if (variant.documentId) {
                                throw new Error(
                                    "Existing variant documentId is not allowed when converting a flat service to variant."
                                );
                            }

                            if (!variant.documentId) {
                                if (!variant.name) {
                                    throw new Error("Variant name is required.");
                                }

                                if (variant.price === undefined) {
                                    throw new Error("Price is required.");
                                }
                            }

                            const createdVariant = await strapi
                                .documents("api::service-varient.service-varient")
                                .create({
                                    data: {
                                        name: variant.name,
                                        image: variant.image,
                                        service: existingService.documentId,
                                        expressDeliveryAvailable:
                                            variant.expressDeliveryAvailable ?? true,
                                    },
                                    transaction: trx,
                                });

                            await strapi
                                .documents("api::service-pricing.service-pricing")
                                .create({
                                    data: {
                                        service_varient: createdVariant.documentId,
                                        price: variant.price,
                                        offerPrice: variant.offerPrice,
                                        expressDeliveryPrice:
                                            variant.expressDeliveryPrice,
                                    },
                                    transaction: trx,
                                });

                        }

                    }

                    // ------------------------------------
                    // Variant -> Variant
                    // ------------------------------------

                    else {

                        for (const variant of variants) {

                            if (!variant.documentId) {
                                if (!variant.name) {
                                    throw new Error("Variant name is required.");
                                }

                                if (variant.price === undefined) {
                                    throw new Error("Price is required.");
                                }
                            }

                            // ===========================
                            // Update Existing Variant
                            // ===========================

                            if (variant.documentId) {

                                if (
                                    variant.name === undefined &&
                                    variant.image === undefined &&
                                    variant.price === undefined &&
                                    variant.offerPrice === undefined &&
                                    variant.expressDeliveryPrice === undefined &&
                                    variant.expressDeliveryAvailable === undefined
                                ) {
                                    throw new Error(
                                        "No fields provided to update for the existing variant."
                                    );
                                }

                                const existingVariants = Array.isArray(existingService.service_varients)
                                    ? existingService.service_varients
                                    : [];

                                const existingVariant = existingVariants.find(
                                    (v: any) => v.documentId === variant.documentId
                                );

                                if (!existingVariant) {
                                    throw new Error(
                                        `Variant ${variant.documentId} not found.`
                                    );
                                }

                                await strapi
                                    .documents("api::service-varient.service-varient")
                                    .update({
                                        documentId: existingVariant.documentId,
                                        data: {
                                            ...(variant.name !== undefined && {
                                                name: variant.name,
                                            }),
                                            ...(variant.image !== undefined && {
                                                image: variant.image,
                                            }),
                                            ...(variant.expressDeliveryAvailable !== undefined && {
                                                expressDeliveryAvailable:
                                                    variant.expressDeliveryAvailable,
                                            }),
                                        },
                                        transaction: trx,
                                    });

                                const pricing =
                                    existingVariant.service_pricings?.[0];

                                if (pricing) {

                                    await strapi
                                        .documents(
                                            "api::service-pricing.service-pricing"
                                        )
                                        .update({
                                            documentId: pricing.documentId,
                                            data: {
                                                ...(variant.price !== undefined && {
                                                    price: variant.price,
                                                }),
                                                ...(variant.offerPrice !==
                                                    undefined && {
                                                    offerPrice:
                                                        variant.offerPrice,
                                                }),
                                                ...(variant.expressDeliveryPrice !==
                                                    undefined && {
                                                    expressDeliveryPrice:
                                                        variant.expressDeliveryPrice,
                                                }),
                                            },
                                            transaction: trx,
                                        });

                                } else {

                                    if (variant.price === undefined) {
                                        throw new Error(
                                            `Price is required for variant "${existingVariant.name}".`
                                        );
                                    }

                                    await strapi
                                        .documents(
                                            "api::service-pricing.service-pricing"
                                        )
                                        .create({
                                            data: {
                                                service_varient:
                                                    existingVariant.documentId,
                                                price: variant.price,
                                                offerPrice:
                                                    variant.offerPrice,
                                                expressDeliveryPrice:
                                                    variant.expressDeliveryPrice,
                                            },
                                            transaction: trx,
                                        });

                                }

                            }

                            // ===========================
                            // Create New Variant
                            // ===========================

                            else {

                                const createdVariant = await strapi
                                    .documents("api::service-varient.service-varient")
                                    .create({
                                        data: {
                                            name: variant.name,
                                            image: variant.image,
                                            service:
                                                existingService.documentId,
                                            expressDeliveryAvailable:
                                                variant.expressDeliveryAvailable ?? true,
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
                                            offerPrice:
                                                variant.offerPrice,
                                            expressDeliveryPrice:
                                                variant.expressDeliveryPrice,
                                        },
                                        transaction: trx,
                                    });

                            }

                        }

                    }

                }

                // ===========================
                // Commit Transaction
                // ===========================

                await trx.commit();

                // ===========================
                // Populate Response
                // ===========================

                const populate =
                    finalPricingModel === "flat"
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
                        };

                const updatedService = await strapi.documents(uid).findOne({
                    documentId: existingService.documentId,
                    populate,
                });

                return ctx.send({
                    message: "Service updated successfully.",
                    data: updatedService,
                });

            } catch (error) {

                await trx.rollback();

                const message =
                    error instanceof Error
                        ? error.message
                        : "Unable to update service.";

                return ctx.badRequest(message);
            }

        },

        async delete(ctx) {
            const trx = await strapi.db.transaction();

            try {
                const { id: documentId } = ctx.params;
                const uid = "api::service.service";

                const service = await strapi.documents(uid).findOne({
                    documentId,
                    populate: {
                        service_pricings: true,
                        service_varients: {
                            populate: {
                                service_pricings: true,
                            },
                        },
                    },
                });

                if (!service) {
                    throw new Error("Service not found.");
                }

                if (service.pricingModel === "flat") {
                    // Delete flat pricing
                    if (service.service_pricings?.length) {
                        for (const pricing of service.service_pricings) {
                            await strapi
                                .documents("api::service-pricing.service-pricing")
                                .delete({
                                    documentId: pricing.documentId,
                                    transaction: trx,
                                });
                        }
                    }
                } else if (service.pricingModel === "variant") {
                    // Delete all variant pricings
                    for (const variant of service.service_varients || []) {
                        for (const pricing of variant.service_pricings || []) {
                            await strapi
                                .documents("api::service-pricing.service-pricing")
                                .delete({
                                    documentId: pricing.documentId,
                                    transaction: trx,
                                });
                        }
                    }

                    // Delete all variants
                    for (const variant of service.service_varients || []) {
                        await strapi
                            .documents("api::service-varient.service-varient")
                            .delete({
                                documentId: variant.documentId,
                                transaction: trx,
                            });
                    }
                }

                // Delete service
                await strapi.documents(uid).delete({
                    documentId: service.documentId,
                    transaction: trx,
                });

                await trx.commit();

                return ctx.send({
                    message: "Service deleted successfully.",
                });
            } catch (error: any) {
                await trx.rollback();

                strapi.log.error("Error deleting service:", error);

                return ctx.badRequest(
                    error?.message || "Failed to delete service."
                );
            }
        },

        async findServiceByName(ctx) {
            try {
                const { name } = ctx.params;

                const service = await strapi
                    .documents("api::service.service")
                    .findFirst({
                        filters: {
                            name: {
                                $eqi: name,
                            },
                        },
                    });

                if (!service) {
                    return ctx.notFound("Service not found.");
                }

                const response = await strapi
                    .documents("api::service.service")
                    .findOne({
                        documentId: service.documentId,
                        populate:
                            service.pricingModel === "flat"
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

                if (!response) {
                    return ctx.notFound("Service not found.");
                }

                const formattedResponse = {
                    documentId: response.documentId,
                    name: response.name,
                    imageUrl: response.image?.url || null,
                    scheduleType: response.scheduleType,
                    isActive: response.isActive,

                    service_category: response.service_category
                        ? {
                            documentId: response.service_category.documentId,
                            name: response.service_category.name,
                            description: response.service_category.description,
                            isActive: response.service_category.isActive,
                        }
                        : null,

                    ...(response.pricingModel === "flat"
                        ? {
                            service_pricings: (response.service_pricings || []).map((pricing) => ({
                                documentId: pricing.documentId,
                                price: pricing.price,
                                offerPrice: pricing.offerPrice,
                                isActive: pricing.isActive,
                                expressDeliveryPrice: pricing.expressDeliveryPrice,
                            })),
                        }
                        : {
                            service_varients: (response.service_varients || []).map((variant) => ({
                                documentId: variant.documentId,
                                name: variant.name,
                                isActive: variant.isActive,
                                imageUrl: variant.image?.url || null,
                                service_pricings: (variant.service_pricings || []).map((pricing) => ({
                                    documentId: pricing.documentId,
                                    price: pricing.price,
                                    offerPrice: pricing.offerPrice,
                                    isActive: pricing.isActive,
                                    expressDeliveryPrice: pricing.expressDeliveryPrice,
                                })),
                            })),
                        }),
                };

                ctx.body = {
                    data: formattedResponse,
                };
            } catch (error: any) {
                strapi.log.error("Error fetching service:", error);
                return ctx.badRequest(
                    error?.message || "Failed to fetch service."
                );
            }
        }
    })
);