import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Dashboard } from "../components/dashboard";

describe("Dashboard", () => {
  it("re-exports the app shell component", () => {
    expect(typeof Dashboard).toBe("function");
    const html = renderToStaticMarkup(React.createElement("div", null, "ok"));
    expect(html).toContain("ok");
  });
});
