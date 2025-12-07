# How to Publish to npm

## Prerequisites

1. **Create npm account**: https://www.npmjs.com/signup
2. **Login to npm**: `npm login`

## Publishing Steps

### 1. Update Version

```bash
# Option A: Auto-increment (recommended)
npm version patch   # 1.0.1 -> 1.0.2 (bug fixes)
npm version minor   # 1.0.1 -> 1.1.0 (new features)
npm version major   # 1.0.1 -> 2.0.0 (breaking changes)

# Option B: Set specific version
npm version 1.0.2

# Option C: Manual edit package.json
# Edit "version" field in package.json
```

### 2. Build Project (automatic with prepublishOnly)

```bash
npm run build
```

Note: The `prepublishOnly` script will automatically build before publishing.

### 3. Check Package Name Availability

```bash
npm search <your-package-name>
```

### 4. Publish to npm

```bash
# For public package
npm publish

# For scoped package (e.g., @lynxe/bing-cn-mcp)
npm publish --access public
```

### 5. Verify Publication

```bash
# Check your package on npm
npm view <your-package-name>

# Or visit: https://www.npmjs.com/package/<your-package-name>
```

## Version Numbering

Follow [Semantic Versioning](https://semver.org/):
- **MAJOR.MINOR.PATCH** (e.g., 1.0.1)
- **MAJOR**: Breaking changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes (backward compatible)

## Important Notes

1. **Package name must be unique** on npm
2. **Version number must be higher** than previous version
3. **Build output** (`build/` folder) must exist before publishing
4. **Files to publish** are defined in `package.json` → `files` field
5. **Scoped packages** (e.g., `@username/package`) require `--access public` for public packages

## Troubleshooting

### "Package name already taken"
- Choose a different name
- Use scoped package: `@your-username/package-name`

### "You must verify your email"
- Check your email and verify it on npmjs.com

### "403 Forbidden"
- Make sure you're logged in: `npm whoami`
- Check if package name matches your npm username (for scoped packages)
