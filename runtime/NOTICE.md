# Node runtime

The portable Windows x64 edition includes the following publicly redistributable Node.js runtime:

- Version: v24.19.0
- Upstream: https://nodejs.org/dist/v24.19.0/ ; no user data or global npm configuration is included.
- File size: 92825416 bytes
- SHA-256: 3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237
- Corresponding upstream license: LICENSE-node.txt, fetched from https://raw.githubusercontent.com/nodejs/node/v24.19.0/LICENSE

Node modules retain their own upstream license files. The source edition omits runtime/node.exe and node_modules; install dependencies with npm ci. There is no preconfigured Linux payload, login file, proxy subscription, or personal credential in either public edition.
