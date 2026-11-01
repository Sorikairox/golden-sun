/* The link transport (G6/G7, orchestrator D21): the only thing port/pc/link.c knows about the other console.
 * Implemented in JS (port/web/port_lib.js) by delegating to Module.linkTransport, an object the host supplies:
 *
 *   connected()          -> bool   the peer is there (a data channel is open)
 *   playerId()           -> 0 | 1  0 = parent (room host), 1 = child
 *   send(channel, bytes)           bytes: Uint8Array (a copy; the transport may keep it)
 *   recv(channel)        -> Uint8Array | null   the next message that arrived, oldest first
 *
 * Channel LINK_CH_FRAME is unreliable and unordered (link.c keeps the newest by frame number); LINK_CH_BULK is
 * reliable and ordered. G6 (offline) uses the in-memory pair of port/web/link_loopback.js; G7 swaps in two
 * WebRTC data channels (one with ordered:false, maxRetransmits:0) without touching link.c.
 * With no Module.linkTransport the link is never connected (single player). */
#ifndef PORT_LINK_TRANSPORT_H
#define PORT_LINK_TRANSPORT_H

enum { LINK_CH_FRAME = 0, LINK_CH_BULK = 1 };

int port_link_connected(void);
int port_link_player_id(void);
void port_link_send(int channel, const void *data, int length);
/* Copies up to `max` bytes of the next message into buf and returns its full length; -1 when none is waiting */
int port_link_recv(int channel, void *buf, int max);

#endif
