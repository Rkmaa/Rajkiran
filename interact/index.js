const crypto = require("crypto");

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

async function createGithubIssue({ title, body }) {
  const repo = process.env.GITHUB_REPO;
  const resp = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      Authorization: `token ${process.env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "azure-function-slack-bot"
    },
    body: JSON.stringify({ title, body })
  });
  return resp.json();
}

module.exports = async function (context, req) {
  if (!verifySlackRequest(req)) {
    context.res = { status: 401, body: "invalid signature" };
    return;
  }

  const form = new URLSearchParams(req.rawBody);
  const payload = JSON.parse(form.get("payload") || "{}");

  if (payload.type === "view_submission") {
    const vals = payload.view.state.values;
    const title = vals["title_b"]["title"].value;
    const desc = vals["desc_b"]["desc"].value;

    const issue = await createGithubIssue({ title, body: desc });

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        response_action: "update",
        view: {
          type: "modal",
          title: { type: "plain_text", text: "Done" },
          close: { type: "plain_text", text: "Close" },
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `Created issue: <${issue.html_url}|#${issue.number}>`
              }
            }
          ]
        }
      }
    };
    return;
  }

  context.res = { status: 200, body: "" };
};
