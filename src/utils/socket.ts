import { getIO } from "../socket";

interface OrderStatusUpdatedPayload {
    orderDocumentId: string;
    orderStatus: string;
    updatedAt: string;
}

export const emitOrderStatusUpdated = (
    payload: OrderStatusUpdatedPayload
) => {
    getIO()
        .to(`order-${payload.orderDocumentId}`)
        .emit("order-status-updated", payload);
};