import { describe, expect, it } from "vitest";
import { createLinkCode } from "../src/config.js";

describe("createLinkCode", () => {
  it("returns a 6 digit code", () => {
    expect(createLinkCode()).toMatch(/^\d{6}$/);
  });
});
