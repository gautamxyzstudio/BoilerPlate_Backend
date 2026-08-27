import { factories } from "@strapi/strapi";
import type { Context } from "koa";
import { createNotification } from "../../../utils/notification";
import { getIO } from "../../../socket";
import { generateUniquePaymentId } from "../../../utils/generatePaymentId";

const uid = "api::payment-collection.payment-collection";

export default factories.createCoreController(uid, ({ strapi }) => ({
  // Custom endpoint: GET /payment-collections/logs
  async getAllLogs(ctx: Context) {
    try {
      const user = ctx.state.user;

      if (!user) {
        return ctx.unauthorized("You must be logged in.");
      }

      // Determine user role
      const loggedInUser = await strapi
        .documents("plugin::users-permissions.user")
        .findOne({
          documentId: user.documentId,
          populate: {
            role: true,
          },
        });

      const roleName = loggedInUser?.role?.name;
      const normalizedRole = (roleName || "").replace(/\s+/g, "").toLowerCase();

      let filters: any = {};

      // Customer role: restricted to own payment logs
      if (roleName === "Customer") {
        const userProfile = await strapi.db
          .query("api::user-profile.user-profile")
          .findOne({
            where: {
              users_permissions_user: user.id,
            },
          });

        if (!userProfile) {
          return ctx.badRequest("User profile not found.");
        }

        filters.order = {
          user_profile: {
            documentId: {
              $eq: userProfile.documentId,
            },
          },
        };
      } else if (
        normalizedRole !== "admin" &&
        normalizedRole !== "superadmin" &&
        normalizedRole !== "staff"
      ) {
        return ctx.forbidden("You are not allowed to access payment logs.");
      }

      // Extract query parameters
      const {
        status,
        payment_status,
        search,
        startDate,
        endDate,
        page = 1,
        pageSize = 10,
      } = ctx.query;

      // Payment status filter
      const selectedStatus = status || payment_status;

      if (selectedStatus && selectedStatus !== "all") {
        const validStatuses = [
          "pending",
          "paid",
          "failed",
          "expired",
          "cancelled",
          "refunded",
        ];

        if (!validStatuses.includes(String(selectedStatus))) {
          return ctx.badRequest(
            `Invalid status. Valid values: ${validStatuses.join(", ")} or all.`,
          );
        }

        filters.payment_status = {
          $eq: selectedStatus,
        };
      }

      // Date range filter (paymentDate or createdAt)
      if (startDate || endDate) {
        const dateFilter: any = {};
        if (startDate) dateFilter.$gte = new Date(String(startDate));
        if (endDate) dateFilter.$lte = new Date(String(endDate));

        filters.$or = [{ paymentDate: dateFilter }, { createdAt: dateFilter }];
      }

      // Search query filter
      if (search) {
        const searchTerm = String(search).trim();

        filters.$or = [
          { transactionId: { $containsi: searchTerm } },
          { gatewayOrderId: { $containsi: searchTerm } },
          { gatewayPaymentId: { $containsi: searchTerm } },
          { paymentId: { $containsi: searchTerm } },
          {
            order: {
              orderNo: { $containsi: searchTerm },
            },
          },
          {
            order: {
              user_profile: {
                fullName: { $containsi: searchTerm },
              },
            },
          },
          {
            order: {
              user_profile: {
                phoneNumber: { $containsi: searchTerm },
              },
            },
          },
          {
            order: {
              user_profile: {
                email: { $containsi: searchTerm },
              },
            },
          },
        ];
      }

      // Pagination setup
      const currentPage = Math.max(1, parseInt(String(page), 10) || 1);
      const limit = Math.max(1, parseInt(String(pageSize), 10) || 10);
      const start = (currentPage - 1) * limit;

      // Fetch logs
      const paymentLogs = await strapi.db.query(uid).findMany({
        where: filters,
        orderBy: { paymentDate: "desc" },
        populate: {
          order: {
            populate: {
              user_profile: true,
              order_items: {
                populate: {
                  service: true,
                  service_varient: true,
                },
              },
            },
          },
        },
      });

      // Format log records
      const formattedLogs = (paymentLogs || []).map((log: any) => {
        const order = log.order;
        const userProfile = order?.user_profile;
        const orderItems = order?.order_items;

        return {
          documentId: log.documentId,
          paymentId: log.paymentId || null,
          transactionId: log.transactionId,
          amount: Number(log.amount || 0),
          payment_status: log.payment_status,
          paymentDate: log.paymentDate || log.createdAt,
          createdAt: log.createdAt,
          order: order
            ? {
                orderNo: order.orderNo,
                paymentMethod: order.paymentMethod,
              }
            : null,
          orderItems: Array.isArray(orderItems)
            ? orderItems.map((item: any) => ({
                quantity: item?.quantity || 1,
                totalPrice: item?.totalPrice || 0,
                service: {
                  name: item?.service?.name || null,
                },
                service_varient: {
                  name: item?.service_varient?.name || null,
                },
              }))
            : [],
          customer: userProfile
            ? {
                documentId: userProfile.documentId,
                fullName: userProfile.fullName,
                phoneNumber: userProfile.phoneNumber,
              }
            : null,
        };
      });

      return ctx.send(formattedLogs);
    } catch (error: any) {
      strapi.log.error("Get All Payment Logs Error:", error);

      return ctx.internalServerError(
        error?.message || "Failed to fetch payment logs.",
      );
    }
  },

  async refundPayment(ctx: Context) {
    let trx: any = null;

    try {
      const user = ctx.state.user;

      if (!user) {
        return ctx.unauthorized("You must be logged in.");
      }

      // Authorization check (Admin / SuperAdmin / Staff)
      const loggedInUser = await strapi
        .documents("plugin::users-permissions.user")
        .findOne({
          documentId: user.documentId,
          populate: {
            role: true,
          },
        });

      const roleName = loggedInUser?.role?.name;
      const normalizedRole = (roleName || "").replace(/\s+/g, "").toLowerCase();

      if (
        normalizedRole !== "admin" &&
        normalizedRole !== "superadmin" &&
        normalizedRole !== "staff"
      ) {
        return ctx.forbidden("Only admins can initiate payment refunds.");
      }

      const documentId = ctx.params.documentId || ctx.params.id;

      if (!documentId) {
        return ctx.badRequest("Payment collection documentId is required.");
      }

      const body = ctx.request.body?.data || ctx.request.body || {};
      const { reason = "Admin initiated refund", gatewayRefundId = null } =
        body;

      // Find payment collection with order and user profile
      const paymentCollection: any = await strapi.documents(uid).findOne({
        documentId,
        populate: {
          order: {
            populate: {
              user_profile: true,
            },
          },
        },
      });

      if (!paymentCollection) {
        return ctx.notFound("Payment collection record not found.");
      }

      const associatedOrder = paymentCollection.order;

      // Validate payment status
      if (paymentCollection.payment_status === "refunded") {
        return ctx.badRequest("This payment has already been refunded.");
      }

      if (associatedOrder && associatedOrder.paymentStatus === "refunded") {
        return ctx.badRequest(
          "The order payment status is already marked as refunded.",
        );
      }

      if (
        paymentCollection.payment_status !== "paid" &&
        associatedOrder?.paymentStatus !== "paid"
      ) {
        return ctx.badRequest(
          `Cannot refund a payment with status '${paymentCollection.payment_status}'. Only paid payments can be refunded.`,
        );
      }

      const refundAmount =
        body.refundAmount != null
          ? Number(body.refundAmount)
          : Number(paymentCollection.amount || 0);

      if (isNaN(refundAmount) || refundAmount <= 0) {
        return ctx.badRequest("Invalid refund amount.");
      }

      if (refundAmount > Number(paymentCollection.amount || 0)) {
        return ctx.badRequest(
          "Refund amount cannot exceed original payment amount.",
        );
      }

      // Generate paymentId if missing
      let paymentIdToSave = paymentCollection.paymentId;
      if (!paymentIdToSave) {
        paymentIdToSave = await generateUniquePaymentId(strapi);
      }

      // Start DB Transaction
      trx = await strapi.db.transaction();

      const refundTimestamp = new Date();

      // 1. Update payment collection record
      const existingGatewayResponse = paymentCollection.gatewayResponse || {};
      const updatedGatewayResponse = {
        ...existingGatewayResponse,
        refund: {
          refundAmount,
          reason,
          gatewayRefundId,
          refundedAt: refundTimestamp.toISOString(),
          refundedBy: loggedInUser?.documentId || user.documentId,
        },
      };

      const updatedPaymentCollection = await strapi.documents(uid).update({
        documentId: paymentCollection.documentId,
        data: {
          payment_status: "refunded",
          gatewayResponse: updatedGatewayResponse,
          paymentId: paymentIdToSave,
        },
        transaction: trx,
      });

      // 2. Update associated order
      let updatedOrder: any = null;

      if (associatedOrder) {
        const orderUpdateData: any = {
          paymentStatus: "refunded",
        };

        // If order is active/pending, also mark orderStatus as refunded
        if (
          ["pending", "processing", "pickup_assigned"].includes(
            associatedOrder.orderStatus,
          )
        ) {
          orderUpdateData.orderStatus = "refunded";
        }

        if (reason) {
          orderUpdateData.cancellationReason = `Refunded: ${reason}`;
        }

        updatedOrder = await strapi.documents("api::order.order").update({
          documentId: associatedOrder.documentId,
          data: orderUpdateData,
          transaction: trx,
        });

        // 3. Create order status history record
        await strapi
          .documents("api::order-status-history.order-status-history" as any)
          .create({
            data: {
              order: associatedOrder.documentId,
              statusUpdatedTo: "refunded",
              updatedByType: "admin",
              remarks: `Refund of ₹${refundAmount} processed. Reason: ${reason}`,
            },
            transaction: trx,
          });
      }

      // Commit Transaction
      await trx.commit();

      // Calculate User Total Spent (paid minus refunded payments)
      let userNetSpent = 0;
      const userProfile = associatedOrder?.user_profile;

      if (userProfile) {
        const userPayments = await strapi.documents(uid).findMany({
          filters: {
            order: {
              user_profile: {
                documentId: userProfile.documentId,
              },
            },
          },
          select: ["amount", "payment_status"],
        });

        for (const p of userPayments) {
          if (p.payment_status === "paid") {
            userNetSpent += Number(p.amount || 0);
          } else if (p.payment_status === "refunded") {
            // Deduct refunded payments from total spent
            userNetSpent -= Number(p.amount || 0);
          }
        }

        if (userNetSpent < 0) userNetSpent = 0;
        userNetSpent = Number(userNetSpent.toFixed(2));
      }

      // Non-critical background tasks (notification & socket emission)
      setImmediate(async () => {
        try {
          const orderNoText = associatedOrder
            ? ` (Order ${associatedOrder.orderNo})`
            : "";

          await createNotification({
            strapi,
            title: "Payment Refunded",
            description: `Payment of ₹${refundAmount}${orderNoText} has been refunded. Reason: ${reason}`,
            type: "order",
          });
        } catch (err) {
          strapi.log.error("Refund notification failed:", err);
        }

        try {
          const io = getIO();

          if (associatedOrder) {
            const fullOrder = await strapi
              .documents("api::order.order")
              .findOne({
                documentId: associatedOrder.documentId,
                populate: {
                  payment_collections: true,
                  user_profile: true,
                },
              });

            io.to(`order-${associatedOrder.documentId}`).emit("order-updated", {
              order: fullOrder,
              paymentStatus: "refunded",
            });

            io.to("admin-orders").emit("order-updated", {
              order: fullOrder,
              paymentStatus: "refunded",
            });
          }

          io.to("admin-notifications").emit("payment-refunded", {
            paymentCollectionId: paymentCollection.documentId,
            orderDocumentId: associatedOrder?.documentId,
            refundAmount,
            userNetSpent,
          });
        } catch (err) {
          strapi.log.error("Refund socket emission failed:", err);
        }
      });

      return ctx.send({
        message: "Payment refunded successfully.",
        data: {
          paymentCollection: updatedPaymentCollection,
          order: updatedOrder,
          refund: {
            refundAmount,
            reason,
            gatewayRefundId,
            refundedAt: refundTimestamp,
          },
          customerSpentSummary: userProfile
            ? {
                customerDocumentId: userProfile.documentId,
                customerName: userProfile.fullName,
                netTotalSpent: userNetSpent,
              }
            : null,
        },
      });
    } catch (error: any) {
      if (trx) {
        try {
          await trx.rollback();
        } catch (_) {}
      }

      strapi.log.error("Refund Payment Error:", error);

      return ctx.badRequest(
        error?.message || "Failed to process payment refund.",
      );
    }
  },
}));
