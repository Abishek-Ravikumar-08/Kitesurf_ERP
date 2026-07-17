/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    { name: "no-circular", severity: "error", from: {}, to: { circular: true } },
    {
      name: "no-cross-app-imports",
      severity: "error",
      comment: "apps must not import each other",
      from: { path: "^apps/([^/]+)/" },
      to: { path: "^apps/(?!$1)([^/]+)/" },
    },
    {
      name: "domain-not-import-infra",
      severity: "error",
      comment: "domain/ must not import infra/",
      from: { path: "/domain/" },
      to: { path: "/infra/" },
    },
    {
      name: "no-cross-package-deep-import",
      severity: "error",
      comment: "import a package's public entry (@erp/x), never ANOTHER package's src internals",
      from: { path: "^packages/([^/]+)/" },
      to: {
        path: "^packages/[^/]+/src/",
        pathNot: ["^packages/$1/", "src/index\\.(ts|js)$", "\\.test\\.ts$"],
      },
    },
    {
      name: "no-app-deep-import",
      severity: "error",
      comment: "apps import a package's public entry, not its src internals",
      from: { path: "^apps/" },
      to: { path: "^packages/[^/]+/src/", pathNot: ["src/index\\.(ts|js)$", "\\.test\\.ts$"] },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
  },
};
