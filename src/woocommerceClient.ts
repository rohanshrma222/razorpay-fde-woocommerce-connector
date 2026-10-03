import { WooCommerceConfig, signRequestUrl } from "./auth.js";
import {
  NormalizedOrder,
  OrderStatus,
  OrderStatusFilter,
  OrderNotFoundError,
  WooCommerceHttpError,
} from "./types.js";

export interface ListOrdersParams {
  page?: number;
  perPage?: number;
  status?: OrderStatusFilter;
}

export interface ListOrdersResult {
  orders: NormalizedOrder[];
  page: number;
}

export interface SearchOrdersResult {
  orders: NormalizedOrder[];
}

const KNOWN_STATUSES = new Set<OrderStatus>([
  "pending",
  "processing",
  "on-hold",
  "completed",
  "cancelled",
  "refunded",
  "failed",
  "trash",
]);

function normalizeOrder(raw: any): NormalizedOrder {
  const status: OrderStatus = KNOWN_STATUSES.has(raw.status) ? raw.status : "unknown";
  return {
    id: raw.id,
    status,
    currency: raw.currency ?? "unknown",
    total: raw.total ?? "0.00",
    customer: {
      firstName: raw.billing?.first_name ?? "",
      lastName: raw.billing?.last_name ?? "",
      email: raw.billing?.email ?? "",
    },
    lineItems: Array.isArray(raw.line_items)
      ? raw.line_items.map((li: any) => ({ name: li.name, quantity: li.quantity }))
      : [],
    dateCreated: raw.date_created ?? "",
  };
}

async function fetchSigned(url: string, config: WooCommerceConfig): Promise<Response> {
  const signedUrl = signRequestUrl(url, "GET", config);
  return fetch(signedUrl, { method: "GET", signal: AbortSignal.timeout(10000) });
}

export function createWooCommerceClient(config: WooCommerceConfig) {
  return {
    async listOrders(params: ListOrdersParams = {}): Promise<ListOrdersResult> {
      const { page = 1, perPage = 10, status } = params;
      const url = new URL(`${config.siteUrl}/wp-json/wc/v3/orders`);
      url.searchParams.set("page", String(page));
      url.searchParams.set("per_page", String(perPage));
      if (status) url.searchParams.set("status", status);

      const res = await fetchSigned(url.toString(), config);
      if (!res.ok) {
        throw new WooCommerceHttpError(`Failed to list orders (HTTP ${res.status})`, res.status);
      }
      const raw = (await res.json()) as unknown[];
      return { orders: raw.map(normalizeOrder), page };
    },

    async getOrder(orderId: number): Promise<NormalizedOrder> {
      const url = `${config.siteUrl}/wp-json/wc/v3/orders/${orderId}`;
      const res = await fetchSigned(url, config);
      if (res.status === 404) throw new OrderNotFoundError(orderId);
      if (!res.ok) {
        throw new WooCommerceHttpError(
          `Failed to get order ${orderId} (HTTP ${res.status})`,
          res.status
        );
      }
      const raw = await res.json();
      return normalizeOrder(raw);
    },

    async searchOrders(query: string): Promise<SearchOrdersResult> {
      const url = new URL(`${config.siteUrl}/wp-json/wc/v3/orders`);
      url.searchParams.set("search", query);

      const res = await fetchSigned(url.toString(), config);
      if (!res.ok) {
        throw new WooCommerceHttpError(`Failed to search orders (HTTP ${res.status})`, res.status);
      }
      const raw = (await res.json()) as unknown[];
      return { orders: raw.map(normalizeOrder) };
    },
  };
}

export type WooCommerceClient = ReturnType<typeof createWooCommerceClient>;
