# Third-party components

- Node.js: MIT and included third-party notices. Windows portable edition carries the exact runtime and upstream license described in runtime/NOTICE.md.
- ssh2 1.17.0 and its dependencies: retain the license files in node_modules. Source installation uses package-lock.json and npm ci. Optional native performance addons are not required by this project.
- OpenAI Codex CLI: downloaded by the user-directed installer from the public npm registry, not embedded in the public ZIP. Consult the upstream package license and OpenAI service terms.
- Visual Studio Code Server and Cline are optional user-directed downloads from their upstream services and retain their own licenses. They are not embedded in the public ZIP. This project's MIT license does not relicense them or grant rights to any service account.
- No browser automation framework, cloud provider SDK, account cookies, SSHFS configuration, proxy daemon, pre-authenticated Linux archive, or personal verification screenshot is included.
