# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported from the project below, under its own licence.

## pyUnfoldedCircleRemote

- Project: [jackjpowell/py-unfolded-circle](https://github.com/jackjpowell/py-unfolded-circle)
  (PyPI package `pyUnfoldedCircleRemote`), version 0.16.2 (commit `7d55fb3`,
  2026-04-28), the Python library of the Unfolded Circle integration of Home
  Assistant, by Jack Powell.
- What is ported (rewritten in JavaScript in `src/constants.js` and
  `src/remote/`): the Core API paths read (`pub/version`, `system`,
  `system/power`, `system/power/battery`, `activities`), the API key sent as
  `Authorization: Bearer`, the address normalization (`/api/` added to a bare
  host), the activity commands (`PUT entities/<id>/command` with
  `activity.on` / `activity.off`), the power modes, the fields read from the
  answers (capacity, power supply, serial number, MAC address, activity state)
  and the choice of a localized name (`get_text_for_locale`). The API key
  creation request shown in the docs comes from its `create_api_key`.
- Licence: MIT, as declared in its `pyproject.toml` (`license = { text = "MIT" }`,
  author Jack Powell). Its `LICENSE` file is the MIT text with the copyright
  line of the packaging template it started from ("The Python Packaging
  Authority"), not the name of its author; it is reproduced below exactly as
  it reads:

```
Copyright (c) 2018 The Python Packaging Authority

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Runtime dependency

[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js)
(Apache-2.0) is installed from npm, with its own licence in
`node_modules/@gladysassistant/integration-sdk/LICENSE`; none of its code is
copied here.
