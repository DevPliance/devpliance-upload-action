import * as core from '@actions/core';

async function run(): Promise<void> {
  try {
    // Reads the `message` input defined in action.yml
    const message: string = core.getInput('message', { required: true });

    // api-key isn't used yet — this is a placeholder for the real upload step
    const apiKey: string = core.getInput('api-key');
    if (apiKey) {
      // Mask it in logs just in case, even though secrets passed via `with:`
      // are already masked automatically when sourced from `secrets.*`.
      core.setSecret(apiKey);
    }

    core.info(`DevPlace Upload Action received message: "${message}"`);

    // TODO: replace this with an actual HTTP call to the DevPlace API.
    // For now we just echo the input back out so the workflow can consume it.
    core.setOutput('result', message);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(`DevPlace Upload Action failed: ${error.message}`);
    } else {
      core.setFailed('DevPlace Upload Action failed with an unknown error');
    }
  }
}

run();
