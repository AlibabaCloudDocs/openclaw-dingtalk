
npm_root="$(npm root -g 2>/dev/null || true)"
echo "NPM Root: $npm_root"

node -e '
const fs = require("fs");
const path = require("path");

const npmRoot = process.argv[1];
console.log("Input Root:", npmRoot);

// Target 1: Zod Schema
const schemaPath = path.join(npmRoot, "openclaw/dist/config/zod-schema.core.js");
console.log("Schema Path:", schemaPath);

if (fs.existsSync(schemaPath)) {
    try {
        let c = fs.readFileSync(schemaPath, "utf8");
        // Debug regex match
        const regex = /(maxTokensField:[\s\S]*?\.optional\(\),)/;
        const match = c.match(regex);
        if (match) {
            console.log("Regex matched:", match[0]);
        } else {
            console.log("Regex NOT matched. Content snippet:", c.substring(0, 500));
        }

        if (!c.includes("thinkingFormat")) {
            c = c.replace(
                regex, 
                "$1\n    thinkingFormat: z.union([z.literal(\"openai\"), z.literal(\"zai\"), z.literal(\"qwen\")]).optional(),"
            );
            // DRY RUN: do not write yet
            console.log("Would have patched:", c.includes("thinkingFormat"));
            fs.writeFileSync(schemaPath, c);
        } else {
             console.log("Already patched");
        }
    } catch (e) { console.error("Error patching schema:", e.message); }
} else {
    console.error("Schema file not found");
}
// Target 2: Pi-AI SDK
const piPath = path.join(npmRoot, "openclaw/node_modules/@mariozechner/pi-ai/dist/providers/openai-completions.js");
console.log("Pi Path:", piPath);
if (fs.existsSync(piPath)) {
    try {
        let c = fs.readFileSync(piPath, "utf8");
        // Patch detectCompat to recognize dashscope
        if (!c.includes("isDashScope")) {
            c = c.replace(
                /(const isZai = .*?;)/, 
                "$1\n    const isDashScope = baseUrl.includes(\"dashscope.aliyuncs.com\");"
            );
            c = c.replace(
                /(thinkingFormat: isZai \? \"zai\" : \"openai\",)/, 
                "thinkingFormat: isZai ? \"zai\" : (isDashScope ? \"qwen\" : \"openai\"),"
            );
            // Patch buildParams to support qwen thinking
            c = c.replace(
                /(else if \(options\?\.reasoningEffort && model\.reasoning && compat\.supportsReasoningEffort\) \{)/,
                "else if (compat.thinkingFormat === \"qwen\" && model.reasoning) { params.enable_thinking = !!options?.reasoningEffort; }\n    $1"
            );
            fs.writeFileSync(piPath, c);
            console.log("Patched openai-completions.js");
        } else {
             console.log("SDK Already patched");
        }
    } catch (e) { console.error("Error patching SDK:", e.message); }
} else {
    console.error("SDK file not found at", piPath);
}
' "$npm_root"
