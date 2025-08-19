const { WebClient } = require("@slack/web-api");
const crypto = require("crypto");

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
module.exports = async function (context, req) {
  const ts  = req.headers["x-slack-request-timestamp"];
  const sig = req.headers["x-slack-signature"];
  const rawLen = (req.rawBody || "").length;
  context.log(`slash: ts=${!!ts} sig=${!!sig} rawLen=${rawLen}`);

  if (!verifySlackRequest(req)) {
    context.res = { status: 401, body: "invalid signature" };
    return;
  }

// Verify Slack signature using raw body
function verifySlackRequest(req) {
  const sig = req.headers["x-slack-signature"];
  const ts = req.headers["x-slack-request-timestamp"];
  if (!sig || !ts) return false;

  const five = 60 * 5;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(ts)) > five) return false;

  const base = `v0:${ts}:${req.rawBody}`;
  const hmac = crypto.createHmac("sha256", process.env.SLACK_SIGNING_SECRET);
  hmac.update(base);
  const mySig = `v0=${hmac.digest("hex")}`;

  try {
    return crypto.timingSafeEqual(Buffer.from(mySig), Buffer.from(sig));
  } catch {
    return false;
  }
}

// Azure OpenAI helper
async function askAOAI(prompt) {
  const endpoint = process.env.AOAI_ENDPOINT;
  const apiKey = process.env.AOAI_API_KEY;
  const deployment = process.env.AOAI_DEPLOYMENT;
  const apiVersion = process.env.OPENAI_API_VERSION || "2024-02-01";

  const body = {
    messages: [
      { role: "system", content: "You are an AppSec helper. Be concise (<=150 words)." },
      { role: "user", content: prompt }
    ],
    temperature: 0.3,
    max_tokens: 300
  };

  const res = await fetch(
    `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": apiKey },
      body: JSON.stringify(body)
    }
  );

  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.trim() || "No response.";
}

module.exports = async function (context, req) {
  if (!verifySlackRequest(req)) {
    context.res = { status: 401, body: "invalid signature" };
    return;
  }

  // Slash command payload is x-www-form-urlencoded
  const params = new URLSearchParams(req.rawBody);
  const trigger_id = params.get("trigger_id");
  const response_url = params.get("response_url");
  const text = (params.get("text") || "").trim();

  // 1) Open modal to create an issue
  try {
    await slack.views.open({
      trigger_id,
      view: {
        type: "modal",
        callback_id: "create_issue_modal",
        private_metadata: JSON.stringify({ repo: process.env.GH_REPO }),
        title: { type: "plain_text", text: "Create GitHub Issue" },
        submit: { type: "plain_text", text: "Create" },
        close: { type: "plain_text", text: "Cancel" },
        blocks: [
          {
            type: "input",
            block_id: "title_b",
            label: { type: "plain_text", text: "Title" },
            element: { type: "plain_text_input", action_id: "title", min_length: 5 }
          },
          {
            type: "input",
            block_id: "desc_b",
            label: { type: "plain_text", text: "Description" },
            element: { type: "plain_text_input", action_id: "desc", multiline: true }
          },
          {
            type: "input",
            optional: true,
            block_id: "labels_b",
            label: { type: "plain_text", text: "Labels (comma separated)" },
            element: { type: "plain_text_input", action_id: "labels" }
          },
          {
            type: "input",
            optional: true,
            block_id: "ai_b",
            label: { type: "plain_text", text: "Add AI remediation tips?" },
            element: {
              type: "checkboxes",
              action_id: "ai",
              options: [
                {
                  text: { type: "plain_text", text: "Yes, generate remediation tips" },
                  value: "ai_tips"
                }
              ]
            }
          }
        ]
      }
    });
  } catch (e) {
    context.log.error("views.open failed", e);
  }

  // 2) If the user typed text after the slash command, send an AI reply via delayed response
  if (text && response_url) {
    (async () => {
      try {
        const ai = await askAOAI(text);
        await fetch(response_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            response_type: "ephemeral",
            replace_original: false,
            text: ai
          })
        });
      } catch (e) {
        await fetch(response_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            response_type: "ephemeral",
            text: "Sorry—AI response failed."
          })
        });
      }
    })();
  }

  // Acknowledge within ~3s
  context.res = { status: 200, headers: { "Content-Type": "text/plain" }, body: "Opening form…" };
};
