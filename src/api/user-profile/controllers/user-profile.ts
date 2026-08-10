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

    exists = await strapi.db.query("api::user-profile.user-profile").findOne({
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
              "Please enter a valid 10-digit phone number.",
            );
          }

          normalizedPhoneNumber = normalized.identifier;
        }

        // Normalize email
        let normalizedEmail = body.email;

        if (normalizedEmail) {
          const normalized = normalizeIdentifier(normalizedEmail);

          if (!normalized || normalized.identifierType !== "email") {
            return ctx.badRequest("Please enter a valid email address.");
          }

          normalizedEmail = normalized.identifier;
        }

        // Check duplicate email / phone
        const duplicateProfile = await strapi.db
          .query("api::user-profile.user-profile")
          .findOne({
            where: {
              $or: [
                ...(normalizedEmail ? [{ email: normalizedEmail }] : []),
                ...(normalizedPhoneNumber
                  ? [{ phoneNumber: normalizedPhoneNumber }]
                  : []),
              ],
            },
          });

        if (duplicateProfile) {
          if (normalizedEmail && duplicateProfile.email === normalizedEmail) {
            return ctx.badRequest(
              "Email is already associated with another profile.",
            );
          }

          if (
            normalizedPhoneNumber &&
            duplicateProfile.phoneNumber === normalizedPhoneNumber
          ) {
            return ctx.badRequest(
              "Phone number is already associated with another profile.",
            );
          }
        }

        const customerId = await generateCustomerId();

        const isEmailLogin = Boolean(user.email);
        const isPhoneLogin = Boolean(user.phoneNumber);

        const data = {
          ...body,
          customerId,
          email: normalizedEmail,
          phoneNumber: normalizedPhoneNumber,
          emailVerified: isEmailLogin,
          phoneVerified: isPhoneLogin,
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
          },
        );

        return ctx.send({
          message: "Profile created successfully.",
          data: profile,
        });
      } catch (error) {
        strapi.log.error("Create User Profile Error:", error);

        return ctx.internalServerError("Failed to create profile.");
      }
    },

    async find(ctx) {
      try {
        const user = ctx.state.user;

        if (!user) {
          return ctx.unauthorized("You must be logged in.");
        }

        const userWithRole = await strapi.db
          .query("plugin::users-permissions.user")
          .findOne({
            where: {
              id: user.id,
            },
            populate: {
              role: true,
            },
          });

        const roleName = userWithRole?.role?.name;
        const isAdmin = roleName === "Admin" || roleName === "SuperAdmin";

        const whereClause = isAdmin
          ? {}
          : {
              users_permissions_user: {
                id: user.id,
              },
            };

        const profiles = await strapi.db
          .query("api::user-profile.user-profile")
          .findMany({
            where: whereClause,
            populate: {
              profileImage: true,
              users_permissions_user: true,
              customer_addresses: true,
            },
            orderBy: {
              createdAt: "desc",
            },
          });

        return ctx.send({
          data: profiles,
        });
      } catch (error) {
        strapi.log.error("Find User Profiles Error:", error);

        return ctx.internalServerError("Failed to fetch user profiles.");
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
              "Please enter a valid 10-digit phone number.",
            );
          }

          normalizedPhoneNumber = normalized.identifier;
        }

        // Normalize email
        let normalizedEmail = body.email;

        if (normalizedEmail) {
          const normalized = normalizeIdentifier(normalizedEmail);

          if (!normalized || normalized.identifierType !== "email") {
            return ctx.badRequest("Please enter a valid email address.");
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
                ...(normalizedEmail ? [{ email: normalizedEmail }] : []),
                ...(normalizedPhoneNumber
                  ? [{ phoneNumber: normalizedPhoneNumber }]
                  : []),
              ],
            },
          });

        if (duplicateProfile) {
          if (normalizedEmail && duplicateProfile.email === normalizedEmail) {
            return ctx.badRequest(
              "Email is already associated with another profile.",
            );
          }

          if (
            normalizedPhoneNumber &&
            duplicateProfile.phoneNumber === normalizedPhoneNumber
          ) {
            return ctx.badRequest(
              "Phone number is already associated with another profile.",
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
          },
        );

        const updatedProfile = await strapi.entityService.findOne(
          "api::user-profile.user-profile",
          existingProfile.id,
          {
            populate: {
              profileImage: true,
              users_permissions_user: true,
            },
          },
        );

        return ctx.send({
          message: "Profile updated successfully.",
          data: updatedProfile,
        });
      } catch (error) {
        strapi.log.error("Update User Profile Error:", error);

        return ctx.internalServerError("Failed to update profile.");
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

        const { fullName, email, phoneNumber, address } = body;

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
          streetAddress,
          fullAddress,
          city,
          state,
          postalCode,
          country,
          latitude,
          longitude,
          addressType,
        } = address;

        if (
          !streetAddress ||
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
            { transacting: trx },
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
              emailVerified: true,
              phoneVerified: true,
              users_permissions_user: createdUser.id,
            },
          },
        );

        await strapi.entityService.create("api::address.address", {
          data: {
            streetAddress,
            fullAddress,
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
        });

        await trx.commit();

        const customer = await strapi.entityService.findOne(
          "api::user-profile.user-profile",
          createdProfile.id,
          {
            populate: {
              users_permissions_user: true,
              customer_addresses: true,
            },
          },
        );

        return ctx.created({
          message: "Customer created successfully.",
          data: customer,
        });
      } catch (error) {
        await trx.rollback();

        strapi.log.error(error);

        return ctx.internalServerError(
          "Something went wrong while creating customer.",
        );
      }
    },

    async update(ctx: Context) {
      try {
        const loggedInUser = ctx.state.user;

        if (!loggedInUser) {
          return ctx.unauthorized("You must be logged in.");
        }

        const body = ctx.request.body?.data || ctx.request.body;

        const documentId = ctx.params.id;

        const {
          fullName,
          email,
          phoneNumber,
          accountStatus,
          emailVerified,
          phoneVerified,
          address,
        } = body;

        if (!documentId) {
          return ctx.badRequest("User profile documentId is required.");
        }

        const normalizedEmail = email ? normalizeIdentifier(email) : null;

        if (
          email &&
          (!normalizedEmail || normalizedEmail.identifierType !== "email")
        ) {
          return ctx.badRequest("Invalid email.");
        }

        const normalizedPhone = phoneNumber
          ? normalizeIdentifier(phoneNumber)
          : null;

        if (
          phoneNumber &&
          (!normalizedPhone || normalizedPhone.identifierType !== "phone")
        ) {
          return ctx.badRequest("Invalid phone number.");
        }

        const emailValue = normalizedEmail?.identifier;
        const phoneValue = normalizedPhone?.identifier;

        const loggedInUserWithRole = await strapi.db
          .query("plugin::users-permissions.user")
          .findOne({
            where: {
              id: loggedInUser.id,
            },
            populate: {
              role: true,
            },
          });

        if (!loggedInUserWithRole) {
          return ctx.unauthorized("User not found.");
        }

        const roleName = loggedInUserWithRole.role?.name;

        if (roleName !== "Admin" && roleName !== "SuperAdmin") {
          return ctx.forbidden(
            "Only Admin and SuperAdmin can update customers.",
          );
        }

        const customer = await strapi
          .documents("api::user-profile.user-profile")
          .findOne({
            documentId,
            populate: {
              users_permissions_user: true,
              customer_addresses: true,
            },
          });

        if (!customer) {
          return ctx.notFound("Customer not found.");
        }

        // Validate address payload
        if (address && !address.documentId) {
          return ctx.badRequest("Address documentId is required.");
        }

        // Check duplicate email
        if (email) {
          const existingEmail = await strapi
            .documents("api::user-profile.user-profile")
            .findFirst({
              filters: {
                email: {
                  $eqi: emailValue,
                },
                documentId: {
                  $ne: documentId,
                },
              },
            });

          if (existingEmail) {
            return ctx.badRequest("Email already exists.");
          }
        }

        // Check duplicate phone
        if (phoneNumber) {
          const existingPhone = await strapi
            .documents("api::user-profile.user-profile")
            .findFirst({
              filters: {
                phoneNumber: {
                  $eq: phoneValue,
                },
                documentId: {
                  $ne: documentId,
                },
              },
            });

          if (existingPhone) {
            return ctx.badRequest("Phone number already exists.");
          }
        }

        // Update user profile
        const profileData: Record<string, any> = {};

        if (fullName !== undefined) profileData.fullName = fullName;
        if (emailValue !== undefined) profileData.email = emailValue;
        if (phoneValue !== undefined) profileData.phoneNumber = phoneValue;
        if (accountStatus !== undefined)
          profileData.accountStatus = accountStatus;
        if (emailVerified !== undefined)
          profileData.emailVerified = emailVerified;
        if (phoneVerified !== undefined)
          profileData.phoneVerified = phoneVerified;

        if (Object.keys(profileData).length > 0) {
          await strapi.documents("api::user-profile.user-profile").update({
            documentId,
            data: profileData,
          });
        }

        if (
          customer.users_permissions_user &&
          (email !== undefined || phoneNumber !== undefined)
        ) {
          const userData: Record<string, any> = {};

          if (emailValue !== undefined) {
            userData.email = emailValue;
            userData.username = emailValue;
          }

          if (phoneValue !== undefined) {
            userData.phoneNumber = phoneValue;
          }
          await strapi.db.query("plugin::users-permissions.user").update({
            where: {
              id: customer.users_permissions_user.id,
            },
            data: userData,
          });
        }
        // Verify address belongs to this customer
        if (address) {
          const customerAddresses = (customer.customer_addresses ??
            []) as any[];

          const customerAddress = customerAddresses.find(
            (item) => item.documentId === address.documentId,
          );

          if (!customerAddress) {
            return ctx.notFound(
              "Address not found or does not belong to this customer.",
            );
          }

          const addressData: Record<string, any> = {};

          if (address.streetAddress !== undefined)
            addressData.streetAddress = address.streetAddress;

          if (address.fullAddress !== undefined)
            addressData.fullAddress = address.fullAddress;

          if (address.landmark !== undefined)
            addressData.landmark = address.landmark;

          if (address.city !== undefined) addressData.city = address.city;

          if (address.state !== undefined) addressData.state = address.state;

          if (address.postalCode !== undefined)
            addressData.postalCode = address.postalCode;

          if (address.country !== undefined)
            addressData.country = address.country;

          if (address.latitude !== undefined)
            addressData.latitude = address.latitude;

          if (address.longitude !== undefined)
            addressData.longitude = address.longitude;

          if (address.addressType !== undefined)
            addressData.addressType = address.addressType;

          await strapi.documents("api::address.address").update({
            documentId: address.documentId,
            data: addressData,
          });
        }

        // Fetch updated customer
        const updatedCustomer = await strapi
          .documents("api::user-profile.user-profile")
          .findOne({
            documentId,
            populate: {
              users_permissions_user: true,
              customer_addresses: true,
            },
          });

        return ctx.send({
          message: "Customer updated successfully.",
          data: updatedCustomer,
        });
      } catch (error: any) {
        strapi.log.error("Update Customer Error:", error);

        return ctx.internalServerError(
          error?.message || "Something went wrong while updating customer.",
        );
      }
    },
  }),
);
