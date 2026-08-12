/**
 * driver-detail controller
 */

import { factories } from "@strapi/strapi";

export default factories.createCoreController(
    "api::driver-detail.driver-detail",
    ({ strapi }) => ({
        // =====================================================
        // CREATE DRIVER
        // =====================================================

        async create(ctx) {
            try {
                const {
                    fullName,
                    email,
                    phoneNumber,
                    vehicleNumber,
                    isActive = true,
                    documents = [],
                } = ctx.request.body;

                // ============================================
                // Validate driver details
                // ============================================

                if (!fullName) {
                    return ctx.badRequest("Full name is required.");
                }

                if (!phoneNumber) {
                    return ctx.badRequest("Phone number is required.");
                }

                // ============================================
                // Check duplicate email
                // ============================================

                if (email) {
                    const existingEmail = await strapi.db
                        .query("api::driver-detail.driver-detail")
                        .findOne({
                            where: {
                                email,
                            },
                        });

                    if (existingEmail) {
                        return ctx.badRequest(
                            "A driver with this email already exists."
                        );
                    }
                }

                // ============================================
                // Check duplicate phone
                // ============================================

                const existingPhone = await strapi.db
                    .query("api::driver-detail.driver-detail")
                    .findOne({
                        where: {
                            phoneNumber,
                        },
                    });

                if (existingPhone) {
                    return ctx.badRequest(
                        "A driver with this phone number already exists."
                    );
                }

                // ============================================
                // Create Driver
                // ============================================

                const driver = await strapi.db
                    .query("api::driver-detail.driver-detail")
                    .create({
                        data: {
                            fullName,
                            email,
                            phoneNumber,
                            vehicleNumber,
                            isActive,
                        },
                    });

                // ============================================
                // Create Driver Documents
                // ============================================

                if (documents && Array.isArray(documents)) {
                    for (const document of documents) {
                        if (!document.documentName) {
                            continue;
                        }

                        await strapi.db
                            .query("api::driver-document.driver-document")
                            .create({
                                data: {
                                    documentName: document.documentName,

                                    // Media ID
                                    documentImage: document.documentImage || null,

                                    // Connect document to driver
                                    driver_detail: driver.id,
                                },
                            });
                    }
                }

                // ============================================
                // Fetch Complete Driver
                // ============================================

                const completeDriver = await strapi.db
                    .query("api::driver-detail.driver-detail")
                    .findOne({
                        where: {
                            id: driver.id,
                        },
                        populate: {
                            driver_documents: {
                                populate: {
                                    documentImage: true,
                                },
                            },
                        },
                    });

                // ============================================
                // Response
                // ============================================

                return ctx.created({
                    data: completeDriver,
                });
            } catch (error) {
                strapi.log.error(
                    "Error creating driver:",
                    error
                );

                return ctx.internalServerError(
                    "Failed to create driver."
                );
            }
        },

        // =====================================================
        // UPDATE DRIVER
        // =====================================================

        async update(ctx) {
            try {
                const documentId = ctx.params.id;

                const {
                    fullName,
                    email,
                    phoneNumber,
                    vehicleNumber,
                    isActive,
                    documents,
                } = ctx.request.body;

                // ============================================
                // Find Driver by documentId
                // ============================================

                const existingDriver = await strapi.db
                    .query("api::driver-detail.driver-detail")
                    .findOne({
                        where: {
                            documentId,
                        },
                    });

                if (!existingDriver) {
                    return ctx.notFound("Driver not found.");
                }

                // ============================================
                // Check Duplicate Email
                // ============================================

                if (email && email !== existingDriver.email) {
                    const duplicateEmail = await strapi.db
                        .query("api::driver-detail.driver-detail")
                        .findOne({
                            where: {
                                email,
                                documentId: {
                                    $ne: documentId,
                                },
                            },
                        });

                    if (duplicateEmail) {
                        return ctx.badRequest(
                            "A driver with this email already exists."
                        );
                    }
                }

                // ============================================
                // Check Duplicate Phone
                // ============================================

                if (
                    phoneNumber &&
                    phoneNumber !== existingDriver.phoneNumber
                ) {
                    const duplicatePhone = await strapi.db
                        .query("api::driver-detail.driver-detail")
                        .findOne({
                            where: {
                                phoneNumber,
                                documentId: {
                                    $ne: documentId,
                                },
                            },
                        });

                    if (duplicatePhone) {
                        return ctx.badRequest(
                            "A driver with this phone number already exists."
                        );
                    }
                }

                // ============================================
                // Prepare Driver Update
                // ============================================

                const driverData: any = {};

                if (fullName !== undefined) {
                    driverData.fullName = fullName;
                }

                if (email !== undefined) {
                    driverData.email = email;
                }

                if (phoneNumber !== undefined) {
                    driverData.phoneNumber = phoneNumber;
                }

                if (vehicleNumber !== undefined) {
                    driverData.vehicleNumber = vehicleNumber;
                }

                if (isActive !== undefined) {
                    driverData.isActive = isActive;
                }

                // ============================================
                // Update Driver
                // ============================================

                if (Object.keys(driverData).length > 0) {
                    await strapi.db
                        .query("api::driver-detail.driver-detail")
                        .update({
                            where: {
                                documentId,
                            },
                            data: driverData,
                        });
                }

                // ============================================
                // Handle Driver Documents
                // ============================================

                if (Array.isArray(documents)) {
                    for (const document of documents) {

                        // ==========================================
                        // UPDATE EXISTING DOCUMENT
                        // ==========================================

                        if (document.documentId) {
                            const existingDocument = await strapi.db
                                .query("api::driver-document.driver-document")
                                .findOne({
                                    where: {
                                        documentId: document.documentId,
                                    },
                                    populate: {
                                        driver_detail: true,
                                    },
                                });

                            if (!existingDocument) {
                                continue;
                            }

                            // Make sure this document belongs
                            // to the current driver
                            if (
                                existingDocument.driver_detail?.documentId !==
                                documentId
                            ) {
                                return ctx.badRequest(
                                    "Driver document does not belong to this driver."
                                );
                            }

                            const documentData: any = {};

                            if (document.documentName !== undefined) {
                                documentData.documentName =
                                    document.documentName;
                            }

                            if (document.documentImage !== undefined) {
                                documentData.documentImage =
                                    document.documentImage;
                            }

                            await strapi.db
                                .query("api::driver-document.driver-document")
                                .update({
                                    where: {
                                        documentId: document.documentId,
                                    },
                                    data: documentData,
                                });
                        }

                        // ==========================================
                        // CREATE NEW DOCUMENT
                        // ==========================================

                        else {
                            if (!document.documentName) {
                                continue;
                            }

                            await strapi.db
                                .query("api::driver-document.driver-document")
                                .create({
                                    data: {
                                        documentName:
                                            document.documentName,

                                        documentImage:
                                            document.documentImage || null,

                                        driver_detail: existingDriver.id,
                                    },
                                });
                        }
                    }
                }

                // ============================================
                // Fetch Updated Driver
                // ============================================

                const updatedDriver = await strapi.db
                    .query("api::driver-detail.driver-detail")
                    .findOne({
                        where: {
                            documentId,
                        },
                        populate: {
                            driver_documents: {
                                populate: {
                                    documentImage: true,
                                },
                            },
                        },
                    });

                return ctx.send({
                    data: updatedDriver,
                });
            } catch (error) {
                strapi.log.error(
                    "Error updating driver:",
                    error
                );

                return ctx.internalServerError(
                    "Failed to update driver."
                );
            }
        },


        // =====================================================
        // FINDALL DRIVERS
        // =====================================================
        async find(ctx) {
            try {
                // ============================================
                // Get all drivers - newest first
                // ============================================

                const drivers = await strapi.db
                    .query("api::driver-detail.driver-detail")
                    .findMany({
                        orderBy: {
                            createdAt: "desc",
                        },
                    });

                // ============================================
                // Add order & document counts
                // ============================================

                const driversWithCounts = await Promise.all(
                    drivers.map(async (driver) => {
                        // ------------------------------------------
                        // Pickup Orders Count
                        // ------------------------------------------

                        const pickupOrdersCount = await strapi.db
                            .query("api::order.order")
                            .count({
                                where: {
                                    pickup_driver: driver.id,
                                },
                            });

                        // ------------------------------------------
                        // Delivery Orders Count
                        // ------------------------------------------

                        const deliveryOrdersCount = await strapi.db
                            .query("api::order.order")
                            .count({
                                where: {
                                    delivery_driver: driver.id,
                                },
                            });

                        // ------------------------------------------
                        // Documents Count
                        // ------------------------------------------

                        const documentsCount = await strapi.db
                            .query("api::driver-document.driver-document")
                            .count({
                                where: {
                                    driver_detail: driver.id,
                                },
                            });

                        // ------------------------------------------
                        // Return Driver + Counts
                        // ------------------------------------------

                        return {
                            ...driver,
                            pickupOrdersCount,
                            deliveryOrdersCount,
                            documentsCount,
                        };
                    })
                );

                // ============================================
                // Response
                // ============================================

                return ctx.send({
                    data: driversWithCounts,
                    meta: {
                        total: driversWithCounts.length,
                    },
                });
            } catch (error) {
                strapi.log.error(
                    "Error fetching drivers:",
                    error
                );

                return ctx.internalServerError(
                    "Failed to fetch drivers."
                );
            }
        },

        // =====================================================
        // FIND ONE DRIVER
        // =====================================================

        async findOne(ctx) {
            try {
                const documentId = ctx.params.id;
                console.log(ctx.params.id, "id");

                // ============================================
                // Find Driver by documentId
                // ============================================

                const driver = await strapi.db
                    .query("api::driver-detail.driver-detail")
                    .findOne({
                        where: {
                            documentId,
                        },
                    });

                if (!driver) {
                    return ctx.notFound("Driver not found.");
                }

                // ============================================
                // Get Driver Documents
                // ============================================

                const driverDocuments = await strapi.db
                    .query("api::driver-document.driver-document")
                    .findMany({
                        where: {
                            driver_detail: driver.id,
                        },
                        populate: {
                            documentImage: true,
                        },
                        orderBy: {
                            createdAt: "desc",
                        },
                    });

                // ============================================
                // Format Documents
                // ============================================

                const documents = driverDocuments.map((document) => ({
                    documentId: document.documentId,
                    documentName: document.documentName,
                    documentImage: document.documentImage
                        ? {
                            url: document.documentImage.url,
                            size: document.documentImage.size,
                        }
                        : null,
                }));

                // ============================================
                // Get Pickup Orders
                // ============================================

                const pickupOrders = await strapi.db
                    .query("api::order.order")
                    .findMany({
                        where: {
                            pickup_driver: driver.id,
                        },
                        orderBy: {
                            createdAt: "desc",
                        },
                        select: [
                            "documentId",
                            "orderNo",
                            "grandTotal",
                        ],
                    });

                // ============================================
                // Get Delivery Orders
                // ============================================

                const deliveryOrders = await strapi.db
                    .query("api::order.order")
                    .findMany({
                        where: {
                            delivery_driver: driver.id,
                        },
                        orderBy: {
                            createdAt: "desc",
                        },
                        select: [
                            "documentId",
                            "orderNo",
                            "grandTotal",
                        ],
                    });

                // ============================================
                // Format Orders
                // ============================================

                const formattedPickupOrders = pickupOrders.map(
                    (order) => ({
                        documentId: order.documentId,
                        orderNo: order.orderNo,
                        grandTotal: order.grandTotal,
                    })
                );

                const formattedDeliveryOrders =
                    deliveryOrders.map((order) => ({
                        documentId: order.documentId,
                        orderNo: order.orderNo,
                        grandTotal: order.grandTotal,
                    }));

                // ============================================
                // Response
                // ============================================

                return ctx.send({
                    data: {
                        ...driver,

                        driver_documents: documents,

                        order_pickup: formattedPickupOrders,

                        order_deliver: formattedDeliveryOrders,
                    },
                });
            } catch (error) {
                strapi.log.error(
                    "Error fetching driver:",
                    error
                );

                return ctx.internalServerError(
                    "Failed to fetch driver."
                );
            }
        }

    })
);