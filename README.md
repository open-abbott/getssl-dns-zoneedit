# getssl-dns-zoneedit

The getssl script is a very solid way to obtain and update Let's
Encrypt certificates. When using wildcard SSL certificates, they
authorize distribution of a certificate based on the existence of a
specially formed TXT record in the DNS entry for the site in question.

ZoneEdit is a cheap/free DNS provider that I've used for decades.
Unfortunately they do not offer an API to update zone data.

getssl includes a few different tools for managing this DNS
authorization process, but not one for ZoneEdit (understandably).

This tool pretends to be a web browser and manipulates the web forms
to achieve an equivalent result.

ZONEEDIT_USER=user ZONEEDIT_PASS=password node index.js add your.host.name txtdata
