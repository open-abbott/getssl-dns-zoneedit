# getssl-dns-zoneedit

> ## ZoneEdit has implemented two-factor authentication!
>
> As a result, this tooling is much less useful.  It supports adding a
> temporary authenticator token, but this will result in it only working
> within a very short window (not really applicable for unattended
> operation).
>
> YMMV

The [getssl](https://github.com/srvrco/getssl) script is a very solid way to
obtain and update [Let's Encrypt](https://letsencrypt.org/) certificates. When
using wildcard SSL certificates, they authorize distribution of a certificate
based on the existence of a specially formed TXT record in the DNS entry for the
site in question.

[ZoneEdit](https://www.zoneedit.com/) is a cheap/free DNS provider that I've
used for decades. Unfortunately they do not offer an API to update zone data.

[getssl](https://github.com/srvrco/getssl) includes a few different tools for
managing this DNS authorization process, but not one for
[ZoneEdit](https://www.zoneedit.com/) (understandably).

This tool pretends to be a web browser and manipulates the web forms
to achieve an equivalent result.

## Installation

1. Clone this repository somewhere locally.
2. Run the command `npm ci` within the repository clone.

## Configuration

The settings that must be added to the
[getssl](https://github.com/srvrco/getssl) configuration for the domain are very
similar to those for using the cPanel DNS tool.

```
VALIDATE_VIA_DNS="true"
DNS_ADD_COMMAND="/path/to/getssl-dns-zoneedit/index.js add"
DNS_DEL_COMMAND="/path/to/getssl-dns-zoneedit/index.js del"
export ZONEEDIT_USER="your username"
export ZONEEDIT_PASS="your password"
export ZONEEDIT_TOKEN="your second factor token"
```
