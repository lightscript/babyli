# @oigroup/babylon-lightscript

> NB: This is a fork of babylon-lightscript which implements language changes that are not necessarily endorsed by upstream. Generally speaking, our intent is to closely follow the upstream language -- however, there may be notable deviations which are documented below.

The parser for [LightScript](http://lightscript.org).
To be used with [@oigroup/babel-plugin-lightscript](https://github.com/wcjohnson/babel-plugin-lightscript).

A minimally-invasive fork of [Babylon](https://github.com/babel/babylon).
With the exception of a few reserved keywords,
it parses JS as JS unless the `"lightscript"` plugin is passed.

### Contributing

    yarn
    npm run build
    npm test

New tests should go in the
[lightscript](https://github.com/lightscript/babylon-lightscript/tree/lightscript/test/fixtures/lightscript)
directory.

### Deviations from LightScript proper

None so far!
