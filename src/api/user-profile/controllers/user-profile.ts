/**
 * user-profile controller
 */

import { factories } from "@strapi/strapi";
import { normalizeIdentifier } from "../../../utils/normalizeIdentifier";
import crypto from "crypto";
import { Context } from "koa";


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

const generateTemporaryPassword = () => {
    return crypto.randomBytes(8).toString("hex");
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
        },

        async customerCreatedByAdmin(ctx: Context) {

            const trx = await strapi.db.transaction();

            try {

                const loggedInUser = ctx.state.user;

                if (!loggedInUser) {
                    await trx.rollback();
                    return ctx.unauthorized("You are not authorized.");
                }

                const body = ctx.request.body?.data || ctx.request.body;

                const {
                    fullName,
                    email,
                    phoneNumber,
                    address,
                } = body;

                const normalizedEmail = normalizeIdentifier(email);

                if (!normalizedEmail || normalizedEmail.identifierType !== "email") {
                    await trx.rollback();
                    return ctx.badRequest("Please provide a valid email address.");
                }

                const normalizedPhone = normalizeIdentifier(phoneNumber);

                if (!normalizedPhone || normalizedPhone.identifierType !== "phone") {
                    await trx.rollback();
                    return ctx.badRequest("Please provide a valid phone number.");
                }

                const emailValue = normalizedEmail.identifier;
                const phoneValue = normalizedPhone.identifier;

                if (!fullName) {
                    await trx.rollback();
                    return ctx.badRequest("Full name is required.");
                }

                if (!email) {
                    await trx.rollback();
                    return ctx.badRequest("Email is required.");
                }

                if (!phoneNumber) {
                    await trx.rollback();
                    return ctx.badRequest("Phone number is required.");
                }

                if (!address) {
                    await trx.rollback();
                    return ctx.badRequest("Address is required.");
                }

                const {
                    addressTitle,
                    fullAddress,
                    landmark,
                    city,
                    state,
                    postalCode,
                    country,
                    latitude,
                    longitude,
                    addressType,
                } = address;

                if (
                    !addressTitle ||
                    !fullAddress ||
                    !city ||
                    !state ||
                    !postalCode ||
                    !country ||
                    !addressType
                ) {
                    await trx.rollback();
                    return ctx.badRequest("Please provide complete address.");
                }

                const existingEmail = await strapi.db
                    .query("plugin::users-permissions.user")
                    .findOne({
                        where: {
                            email: emailValue,
                        },
                    });

                if (existingEmail) {
                    await trx.rollback();
                    return ctx.badRequest("Email already exists.");
                }

                const existingPhone = await strapi.db
                    .query("plugin::users-permissions.user")
                    .findOne({
                        where: {
                            phoneNumber: phoneValue,
                        },

                    });

                if (existingPhone) {
                    await trx.rollback();
                    return ctx.badRequest("Phone number already exists.");
                }

                const customerRole = await strapi.db
                    .query("plugin::users-permissions.role")
                    .findOne({
                        where: {
                            name: "Customer",
                        },

                    });

                if (!customerRole) {
                    await trx.rollback();
                    return ctx.badRequest("Customer role not found.");
                }

                const customerId = await generateCustomerId();

                const temporaryPassword = generateTemporaryPassword();

                const createdUser = await strapi
                    .plugin("users-permissions")
                    .service("user")
                    .add(
                        {
                            username: emailValue,
                            email: emailValue,
                            phoneNumber: phoneValue,
                            password: temporaryPassword,
                            provider: "local",
                            confirmed: true,
                            blocked: false,
                            role: customerRole.id,
                        },
                        { transacting: trx }
                    );

                const createdProfile = await strapi.entityService.create(
                    "api::user-profile.user-profile",
                    {
                        data: {
                            fullName,
                            email: emailValue,
                            phoneNumber: phoneValue,
                            customerId,
                            userType: "customer",
                            accountStatus: "approved",
                            users_permissions_user: createdUser.id,
                        },
                    }
                );

                await strapi.entityService.create(
                    "api::address.address",
                    {
                        data: {
                            streetAddress: addressTitle,
                            fullAddress,
                            landmark,
                            city,
                            state,
                            postalCode,
                            country,
                            latitude,
                            longitude,
                            addressType,
                            isDefaultAddress: true,
                            user_profile: createdProfile.id,
                        },
                        transacting: trx,
                    }
                );

                await trx.commit();

                const customer = await strapi.entityService.findOne(
                    "api::user-profile.user-profile",
                    createdProfile.id,
                    {
                        populate: {
                            users_permissions_user: true,
                            customer_addresses: true,
                        },
                    }
                );

                return ctx.created({
                    message: "Customer created successfully.",
                    data: customer,
                });

            } catch (error) {

                await trx.rollback();

                strapi.log.error(error);

                return ctx.internalServerError(
                    "Something went wrong while creating customer."
                );
            }

        },


    })
);