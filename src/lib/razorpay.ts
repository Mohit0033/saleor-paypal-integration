import Razorpay from "razorpay";
import crypto from "crypto";

const keyId = process.env.RAZORPAY_KEY_ID;
const keySecret = process.env.RAZORPAY_KEY_SECRET;

if (!keyId || !keySecret) {
  console.error("❌ FATAL: RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET is missing!");
}

export const razorpay = new Razorpay({
  key_id: keyId!,
  key_secret: keySecret!,
});

export function verifyPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string
): boolean {
  if (!keySecret) {
    console.error("verifyPaymentSignature: RAZORPAY_KEY_SECRET is not set");
    return false;
  }

  try {
    const body = orderId + "|" + paymentId;
    const expectedSignature = crypto
      .createHmac("sha256", keySecret)
      .update(body)
      .digest("hex");
    return expectedSignature === signature;
  } catch (error) {
    console.error("verifyPaymentSignature error:", error);
    return false;
  }
}