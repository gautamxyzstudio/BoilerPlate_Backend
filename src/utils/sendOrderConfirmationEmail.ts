import axios from "axios";

export const sendOrderConfirmationEmail = async (
    email: string,
    customerName: string,
    orderNo: string,
    amount: number,
    paymentMethod: string,
    orderItems: any[]
): Promise<void> => {
    const itemsHtml = orderItems
        .map(
            (item) => `
            <tr>
                <td style="padding:10px;">${item.serviceName}</td>
                <td style="padding:10px;">${item.variantName || "-"}</td>
                <td style="padding:10px;text-align:center;">${item.quantity}</td>
                <td style="padding:10px;text-align:right;">₹${item.totalPrice}</td>
            </tr>
        `
        )
        .join("");

    try {
        await axios.post(
            "https://api.brevo.com/v3/smtp/email",
            {
                sender: {
                    name: "BoilerPlate",
                    email: process.env.BREVO_EMAIL_SENDER,
                },
                to: [
                    {
                        email,
                    },
                ],
                subject: `Order Confirmation - ${orderNo}`,
                htmlContent: `
                <div style="font-family:Arial,sans-serif;max-width:700px;margin:auto;padding:20px;background:#ffffff;border:1px solid #e5e5e5;border-radius:10px;">

                    <h2 style="color:#2e7d32;margin-bottom:5px;">
                        Thank you for your order, ${customerName}!
                    </h2>

                    <p style="font-size:15px;color:#555;">
                        Your order has been placed successfully.
                    </p>

                    <table style="width:100%;margin-top:20px;border-collapse:collapse;">
                        <tr>
                            <td style="padding:8px 0;"><strong>Order Number</strong></td>
                            <td>${orderNo}</td>
                        </tr>

                        <tr>
                            <td style="padding:8px 0;"><strong>Payment Method</strong></td>
                            <td>${paymentMethod.toUpperCase()}</td>
                        </tr>

                        <tr>
                            <td style="padding:8px 0;"><strong>Grand Total</strong></td>
                            <td><strong>₹${amount}</strong></td>
                        </tr>
                    </table>

                    <h3 style="margin-top:30px;">
                        Order Items
                    </h3>

                    <table
                        style="width:100%;border-collapse:collapse;border:1px solid #ddd;"
                    >

                        <thead style="background:#f5f5f5;">
                            <tr>
                                <th style="padding:10px;text-align:left;">Service</th>
                                <th style="padding:10px;text-align:left;">Item</th>
                                <th style="padding:10px;">Qty</th>
                                <th style="padding:10px;text-align:right;">Total</th>
                            </tr>
                        </thead>

                        <tbody>
                            ${itemsHtml}
                        </tbody>

                    </table>

                    <p style="margin-top:25px;color:#666;">
                        We'll notify you once your order is processed.
                    </p>

                    <p style="margin-top:20px;">
                        Thank you for choosing <strong>BoilerPlate</strong>.
                    </p>

                </div>
                `,
            },
            {
                headers: {
                    "api-key": process.env.BREVO_API_KEY,
                    "Content-Type": "application/json",
                },
            }
        );
    } catch (error: any) {
        console.error("BREVO STATUS:", error.response?.status);
        console.error("BREVO DATA:", error.response?.data);

        throw new Error("Failed to send order confirmation email.");
    }
};