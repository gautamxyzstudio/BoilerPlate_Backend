/**
 * user-profile controller
 */

import { factories } from "@strapi/strapi";
import { normalizeIdentifier } from "../../../utils/normalizeIdentifier";

const generateCustomerId = async () => {
    let customerId;
    let exists = true;

    while (exists) {
        customerId = `K3-${Math.floor(100000 + Math.random() * 900000)}`;

        exists = await strapi.db
            .query("api::user-profile.user-profile")
            .findOne({
                where: {
                    customerId,
                },
            });
    }

    return customerId;
};

export default factories.createCoreController(
    "api::user-profile.user-profile",
    ({ strapi }) => ({
        async create(ctx) {
            try {
                const user = ctx.state.user;

                if (!user) {
                    return ctx.unauthorized("You must be logged in.");
                }

                const body = ctx.request.body?.data || ctx.request.body;

                // Check if profile already exists for this user
                const existingProfile = await strapi.db
                    .query("api::user-profile.user-profile")
                    .findOne({
                        where: {
                            users_permissions_user: {
                                id: user.id,
                            },
                        },
                    });

                if (existingProfile) {
                    return ctx.badRequest("User profile already exists.");
                }

                // Normalize phone number
                let normalizedPhoneNumber = body.phoneNumber;

                if (normalizedPhoneNumber) {
                    const normalized = normalizeIdentifier(normalizedPhoneNumber);

                    if (!normalized || normalized.identifierType !== "phone") {
                        return ctx.badRequest(
                            "Please enter a valid 10-digit phone number."
                        );
                    }

                    normalizedPhoneNumber = normalized.identifier;
                }

                // Normalize email
                let normalizedEmail = body.email;

                if (normalizedEmail) {
                    const normalized = normalizeIdentifier(normalizedEmail);

                    if (!normalized || normalized.identifierType !== "email") {
                        return ctx.badRequest(
                            "Please enter a valid email address."
                        );
                    }

                    normalizedEmail = normalized.identifier;
                }

                // Check duplicate email / phone
                const duplicateProfile = await strapi.db
                    .query("api::user-profile.user-profile")
                    .findOne({
                        where: {
                            $or: [
                                ...(normalizedEmail
                                    ? [{ email: normalizedEmail }]
                                    : []),
                                ...(normalizedPhoneNumber
                                    ? [{ phoneNumber: normalizedPhoneNumber }]
                                    : []),
                            ],
                        },
                    });

                if (duplicateProfile) {
                    if (
                        normalizedEmail &&
                        duplicateProfile.email === normalizedEmail
                    ) {
                        return ctx.badRequest(
                            "Email is already associated with another profile."
                        );
                    }

                    if (
                        normalizedPhoneNumber &&
                        duplicateProfile.phoneNumber === normalizedPhoneNumber
                    ) {
                        return ctx.badRequest(
                            "Phone number is already associated with another profile."
                        );
                    }
                }

                const customerId = await generateCustomerId();

                const data = {
                    ...body,
                    customerId,
                    email: normalizedEmail,
                    phoneNumber: normalizedPhoneNumber,
                    users_permissions_user: user.id,
                    publishedAt: new Date(),
                };

                const profile = await strapi.entityService.create(
                    "api::user-profile.user-profile",
                    {
                        data,
                        populate: {
                            profileImage: true,
                            users_permissions_user: true,
                        },
                    }
                );

                return ctx.send({
                    success: true,
                    message: "Profile created successfully.",
                    data: profile,
                });
            } catch (error) {
                strapi.log.error("Create User Profile Error:", error);

                return ctx.internalServerError(
                    "Failed to create profile."
                );
            }
        },

        async find(ctx) {
            try {
                const user = ctx.state.user;

                if (!user) {
                    return ctx.unauthorized("You must be logged in.");
                }

                const profile = await strapi.db
                    .query("api::user-profile.user-profile")
                    .findOne({
                        where: {
                            users_permissions_user: {
                                id: user.id,
                            },
                        },
                        populate: {
                            profileImage: true,
                            users_permissions_user: true,
                        },
                    });

                if (!profile) {
                    return ctx.notFound("User profile not found.");
                }

                return ctx.send({
                    success: true,
                    data: profile,
                });
            } catch (error) {
                strapi.log.error("Find User Profile Error:", error);

                return ctx.internalServerError(
                    "Failed to fetch profile."
                );
            }
        },

        async updateMe(ctx) {
            try {
                const user = ctx.state.user;

                if (!user) {
                    return ctx.unauthorized("You must be logged in.");
                }

                const body = ctx.request.body?.data || ctx.request.body;

                // Find logged-in user's profile
                const existingProfile = await strapi.db
                    .query("api::user-profile.user-profile")
                    .findOne({
                        where: {
                            users_permissions_user: {
                                id: user.id,
                            },
                        },
                    });

                if (!existingProfile) {
                    return ctx.notFound("User profile not found.");
                }

                // Normalize phone number
                let normalizedPhoneNumber = body.phoneNumber;

                if (normalizedPhoneNumber) {
                    const normalized = normalizeIdentifier(normalizedPhoneNumber);

                    if (!normalized || normalized.identifierType !== "phone") {
                        return ctx.badRequest(
                            "Please enter a valid 10-digit phone number."
                        );
                    }

                    normalizedPhoneNumber = normalized.identifier;
                }

                // Normalize email
                let normalizedEmail = body.email;

                if (normalizedEmail) {
                    const normalized = normalizeIdentifier(normalizedEmail);

                    if (!normalized || normalized.identifierType !== "email") {
                        return ctx.badRequest(
                            "Please enter a valid email address."
                        );
                    }

                    normalizedEmail = normalized.identifier;
                }

                // Check duplicate email / phone (exclude current profile)
                const duplicateProfile = await strapi.db
                    .query("api::user-profile.user-profile")
                    .findOne({
                        where: {
                            id: {
                                $ne: existingProfile.id,
                            },
                            $or: [
                                ...(normalizedEmail
                                    ? [{ email: normalizedEmail }]
                                    : []),
                                ...(normalizedPhoneNumber
                                    ? [{ phoneNumber: normalizedPhoneNumber }]
                                    : []),
                            ],
                        },
                    });

                if (duplicateProfile) {
                    if (
                        normalizedEmail &&
                        duplicateProfile.email === normalizedEmail
                    ) {
                        return ctx.badRequest(
                            "Email is already associated with another profile."
                        );
                    }

                    if (
                        normalizedPhoneNumber &&
                        duplicateProfile.phoneNumber === normalizedPhoneNumber
                    ) {
                        return ctx.badRequest(
                            "Phone number is already associated with another profile."
                        );
                    }
                }

                await strapi.entityService.update(
                    "api::user-profile.user-profile",
                    existingProfile.id,
                    {
                        data: {
                            ...body,
                            ...(normalizedEmail && { email: normalizedEmail }),
                            ...(normalizedPhoneNumber && {
                                phoneNumber: normalizedPhoneNumber,
                            }),
                        },
                    }
                );

                const updatedProfile = await strapi.entityService.findOne(
                    "api::user-profile.user-profile",
                    existingProfile.id,
                    {
                        populate: {
                            profileImage: true,
                            users_permissions_user: true,
                        },
                    }
                );

                return ctx.send({
                    success: true,
                    message: "Profile updated successfully.",
                    data: updatedProfile,
                });
            } catch (error) {
                strapi.log.error("Update User Profile Error:", error);

                return ctx.internalServerError(
                    "Failed to update profile."
                );
            }
        }
    })
);