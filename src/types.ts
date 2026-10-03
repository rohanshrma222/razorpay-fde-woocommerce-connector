export type OrderStatus =
  | "pending"
  | "processing"
  | "on-hold"
  | "completed"
  | "cancelled"
  | "refunded"
  | "failed"
  | "trash"
  | "unknown";

export type OrderStatusFilter = Exclude<OrderStatus, "unknown">;

export interface NormalizedOrder {
  id: number;
  status: OrderStatus;
  currency: string;
  total: string;
  customer: { firstName: string; lastName: string; email: string };
  lineItems: { name: string; quantity: number }[];
  dateCreated: string;
}

export class WooCommerceHttpError extends Error {
  constructor(message: string, public status: number, public body?: unknown) {
    super(message);
    this.name = "WooCommerceHttpError";
  }
}

export class OrderNotFoundError extends WooCommerceHttpError {
  constructor(orderId: number) {
    super(`Order ${orderId} not found`, 404);
    this.name = "OrderNotFoundError";
  }
}
