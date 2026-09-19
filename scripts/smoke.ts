/**
 * Live check that the API key, network path and model route all work.
 *
 * Run with `npm run smoke`. It issues one billable request.
 */
import { choice, noul, score } from "@typesafe-ai/sdk";
import { createJevClient } from "../src/client.js";
import { ConfigError } from "../src/config.js";

const state = {
  ticket: "I was charged twice for the same order and nobody has replied in three days.",
  customer_tier: "paid",
};

const main = async (): Promise<void> => {
  const client = createJevClient();

  const startedAt = performance.now();
  const { model, answers, usage } = await client.systemOne({
    state,
    questions: {
      category: choice("What is this ticket about?", {
        billing: "Charges, refunds, invoices, or subscriptions.",
        technical: "The product is broken or behaving unexpectedly.",
        other: null,
      }),
      urgency: score("How urgent is this ticket?", [
        "Can wait a week.",
        "Should be handled this week.",
        "Should be handled today.",
        "Needs someone right now.",
      ]),
      needs_human: noul("Does this ticket need a human agent?", {
        true: "A person must read the ticket before replying.",
        false: "An automated reply would resolve it.",
      }),
    },
  });
  const elapsedMs = Math.round(performance.now() - startedAt);

  console.log(`model: ${model}  latency: ${elapsedMs}ms`);
  console.log(
    `category: ${answers.category.choice} (confidence ${answers.category.confidence.toFixed(3)})`,
  );
  console.log(`  probabilities: ${JSON.stringify(answers.category.probabilities)}`);
  console.log(
    `urgency: ${answers.urgency.score.toFixed(2)} (confidence ${answers.urgency.confidence.toFixed(3)})`,
  );
  console.log(`needs_human: p(yes) = ${answers.needs_human.noul.toFixed(3)}`);
  console.log(`usage: ${usage.input_tokens} in / ${usage.output_tokens} out`);
};

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
