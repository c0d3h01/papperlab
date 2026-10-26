package tools

import (
	"context"
	"fmt"
	"net"
	"net/netip"
	"net/url"
	"strings"
	"time"
)

// Addresses that are not safe for an outbound fetch from a shared service.
var blockedIPPrefixes = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("10.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("127.0.0.0/8"),
	netip.MustParsePrefix("169.254.0.0/16"),
	netip.MustParsePrefix("172.16.0.0/12"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("192.168.0.0/16"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("224.0.0.0/4"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("255.255.255.255/32"),
	netip.MustParsePrefix("::/128"),
	netip.MustParsePrefix("::1/128"),
	netip.MustParsePrefix("64:ff9b::/96"),
	netip.MustParsePrefix("64:ff9b:1::/48"),
	netip.MustParsePrefix("100::/64"),
	netip.MustParsePrefix("2001::/32"),
	netip.MustParsePrefix("2001:db8::/32"),
	netip.MustParsePrefix("2002::/16"),
	netip.MustParsePrefix("fc00::/7"),
	netip.MustParsePrefix("fe80::/10"),
	netip.MustParsePrefix("ff00::/8"),
}

func blockedIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsValid() {
		return true
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() ||
		ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() {
		return true
	}
	for _, prefix := range blockedIPPrefixes {
		if prefix.Contains(ip) {
			return true
		}
	}
	return false
}

// validateRemoteURL rejects URLs that resolve to a local or private address.
//
// shortcut: DNS is checked before Chrome loads the URL and Chrome resolves the
// host again, so a rebinding host can still reach the local network. Keep
// untrusted deployments behind an egress firewall; upgrade to a filtering
// proxy if that risk matters.
func validateRemoteURL(ctx context.Context, raw string, allowLocal bool) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" {
		return nil, fmt.Errorf("enter a valid http(s) URL")
	}
	if u.User != nil {
		return nil, fmt.Errorf("URLs with embedded credentials are not supported")
	}
	if allowLocal {
		return u, nil
	}
	host := u.Hostname()
	if ip, err := netip.ParseAddr(host); err == nil {
		if blockedIP(ip) {
			return nil, fmt.Errorf("this URL points to a private or local address")
		}
		return u, nil
	}
	lookupCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	ips, err := net.DefaultResolver.LookupNetIP(lookupCtx, "ip", host)
	if err != nil {
		return nil, fmt.Errorf("could not resolve the URL host")
	}
	if len(ips) == 0 {
		return nil, fmt.Errorf("could not resolve the URL host")
	}
	for _, ip := range ips {
		if blockedIP(ip) {
			return nil, fmt.Errorf("this URL points to a private or local address")
		}
	}
	return u, nil
}
