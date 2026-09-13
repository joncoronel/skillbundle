import { describe, expect, it } from "vitest";
import { ConvexError } from "convex/values";
import { parseCheckoutRequest } from "../convex/lib/checkout";

const MONTHLY = "prod-monthly";
const YEARLY = "prod-yearly";
const ALLOWED = [MONTHLY, YEARLY];

const valid = {
  productIds: [MONTHLY],
  origin: "https://skillbundle.dev",
  successUrl: "https://skillbundle.dev/pricing",
};

describe("parseCheckoutRequest", () => {
  it("accepts either configured Pro product", () => {
    expect(parseCheckoutRequest(valid, ALLOWED)).toEqual({
      productId: MONTHLY,
      origin: "https://skillbundle.dev",
      successUrl: "https://skillbundle.dev/pricing",
    });
    expect(
      parseCheckoutRequest({ ...valid, productIds: [YEARLY] }, ALLOWED)
        .productId,
    ).toBe(YEARLY);
  });

  it("accepts plain http on localhost for development", () => {
    expect(
      parseCheckoutRequest(
        {
          productIds: [MONTHLY],
          origin: "http://localhost:3000",
          successUrl: "http://localhost:3000/pricing?cycle=yearly",
        },
        ALLOWED,
      ).successUrl,
    ).toBe("http://localhost:3000/pricing?cycle=yearly");
  });

  it.each([
    ["an unknown product", { productIds: ["some-other-product"] }],
    ["no product", { productIds: [] }],
    ["more than one product", { productIds: [MONTHLY, YEARLY] }],
    ["an empty product id", { productIds: [""] }],
  ])("rejects %s", (_, override) => {
    expect(() =>
      parseCheckoutRequest({ ...valid, ...override }, ALLOWED),
    ).toThrow(ConvexError);
  });

  it("does not let an unset product env var match an empty id", () => {
    expect(() =>
      parseCheckoutRequest({ ...valid, productIds: [""] }, [undefined, ""]),
    ).toThrow(ConvexError);
  });

  it.each([
    ["on another origin", { successUrl: "https://evil.example/ok" }],
    ["that is not a URL", { successUrl: "/pricing" }],
    ["with a javascript: scheme", { successUrl: "javascript:alert(1)" }],
    [
      "over http on a public host",
      {
        origin: "http://skillbundle.dev",
        successUrl: "http://skillbundle.dev/pricing",
      },
    ],
  ])("rejects a success URL %s", (_, override) => {
    expect(() =>
      parseCheckoutRequest({ ...valid, ...override }, ALLOWED),
    ).toThrow(ConvexError);
  });
});
