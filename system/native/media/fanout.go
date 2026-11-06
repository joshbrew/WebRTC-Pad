package main

import (
	"encoding/binary"
	"sync"
	"time"

	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

const maxQueuedFrames = 2
const maxFrameAge = 50 * time.Millisecond
const maxFrameBytes = 16 * 1024 * 1024
const maxFramePackets = 16384

// Packet storage belongs to the source, is copied once from its UDP receive
// buffer, and remains immutable while independent viewers send it.
type encodedFrame struct {
	packets []*rtp.Packet
	at      time.Time
	key     bool
}

type frameAssembler struct {
	hevc              bool
	frame             *encodedFrame
	timestamp, ssrc   uint32
	sequence          uint16
	haveSequence, bad bool
	bytes             int
}

func hevcRandomAccess(payload []byte) bool {
	if len(payload) < 2 {
		return false
	}
	kind := (payload[0] >> 1) & 63
	irap := func(n byte) bool { return n >= 16 && n <= 21 }
	if irap(kind) {
		return true
	}
	if kind == 49 {
		return len(payload) > 3 && payload[2]&0x80 != 0 && irap(payload[2]&63)
	}
	if kind == 48 {
		found := false
		for rest := payload[2:]; len(rest) > 0; {
			if len(rest) < 2 {
				return false
			}
			n := int(binary.BigEndian.Uint16(rest))
			rest = rest[2:]
			if n < 2 || n > len(rest) {
				return false
			}
			found = found || irap((rest[0]>>1)&63)
			rest = rest[n:]
		}
		return found
	}
	return false
}

func randomAccess(payload []byte) bool {
	if len(payload) == 0 {
		return false
	}
	switch payload[0] & 31 {
	case 5:
		return true
	case 28:
		return len(payload) > 2 && payload[1]&0x80 != 0 && payload[1]&31 == 5
	case 24:
		found := false
		for rest := payload[1:]; len(rest) > 0; {
			if len(rest) < 2 {
				return false
			}
			n := int(binary.BigEndian.Uint16(rest))
			rest = rest[2:]
			if n == 0 || n > len(rest) {
				return false
			}
			found = found || rest[0]&31 == 5
			rest = rest[n:]
		}
		return found
	}
	return false
}

// The RTP marker terminates an H.264 access unit. No future frame or timer is
// awaited. Incomplete source frames invalidate dependent queued video.
func (a *frameAssembler) push(packet *rtp.Packet, now time.Time) (*encodedFrame, bool) {
	gap := a.haveSequence && (packet.SequenceNumber != a.sequence+1 || packet.SSRC != a.ssrc)
	if a.frame != nil && packet.Timestamp != a.timestamp {
		gap = true
		a.frame = nil
	}
	a.sequence, a.ssrc, a.haveSequence = packet.SequenceNumber, packet.SSRC, true
	if a.frame == nil {
		a.frame = &encodedFrame{at: now}
		a.timestamp = packet.Timestamp
		a.bad = false
		a.bytes = 0
	}
	a.bad = a.bad || gap
	a.bytes += len(packet.Payload)
	if a.bytes > maxFrameBytes || len(a.frame.packets) >= maxFramePackets {
		a.bad = true
		a.frame.packets = nil
	}
	if !a.bad {
		if a.hevc {
			a.frame.key = a.frame.key || hevcRandomAccess(packet.Payload)
		} else {
			a.frame.key = a.frame.key || randomAccess(packet.Payload)
		}
		a.frame.packets = append(a.frame.packets, packet.Clone())
	}
	if !packet.Marker {
		return nil, gap
	}
	frame, bad := a.frame, a.bad
	a.frame = nil
	if bad {
		return nil, true
	}
	return frame, gap
}

type deliveryStats struct {
	Pending    int     `json:"pendingFrames"`
	Dropped    uint64  `json:"droppedFrames"`
	Written    uint64  `json:"writtenFrames"`
	WaitingKey bool    `json:"waitingForKeyframe"`
	Failed     bool    `json:"writeFailed"`
	MaxQueueMs float64 `json:"maxQueueMs"`
}

type mediaDelivery struct {
	track               *webrtc.TrackLocalStaticRTP
	write               func(*rtp.Packet) error
	video               bool
	mu                  sync.Mutex
	pending             []*encodedFrame
	waitingKey, closed  bool
	stats               deliveryStats
	wake, done, stopped chan struct{}
	sequence            uint16
	haveSequence        bool
}

func newDelivery(video bool, write func(*rtp.Packet) error) *mediaDelivery {
	d := &mediaDelivery{video: video, write: write, waitingKey: video, wake: make(chan struct{}, 1), done: make(chan struct{}), stopped: make(chan struct{})}
	go d.run()
	return d
}
func (d *mediaDelivery) invalidate() {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.stats.Dropped += uint64(len(d.pending))
	d.pending = nil
	d.waitingKey = d.video
}
func (d *mediaDelivery) offer(frame *encodedFrame) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.closed {
		return
	}
	if len(d.pending) >= maxQueuedFrames {
		d.stats.Dropped += uint64(len(d.pending))
		d.pending = nil
		d.waitingKey = d.video
	}
	if d.waitingKey && !frame.key {
		d.stats.Dropped++
		return
	}
	if frame.key {
		d.waitingKey = false
	}
	d.pending = append(d.pending, frame)
	select {
	case d.wake <- struct{}{}:
	default:
	}
}
func (d *mediaDelivery) take() *encodedFrame {
	d.mu.Lock()
	defer d.mu.Unlock()
	for !d.closed && len(d.pending) > 0 {
		frame := d.pending[0]
		d.pending[0] = nil
		d.pending = d.pending[1:]
		if time.Since(frame.at) > maxFrameAge {
			d.stats.Dropped++
			d.waitingKey = d.video
			continue
		}
		if d.waitingKey && !frame.key {
			d.stats.Dropped++
			continue
		}
		if frame.key {
			d.waitingKey = false
		}
		return frame
	}
	return nil
}
func (d *mediaDelivery) run() {
	defer close(d.stopped)
	for {
		select {
		case <-d.done:
			return
		case <-d.wake:
		}
		for frame := d.take(); frame != nil; frame = d.take() {
			wait := time.Since(frame.at)
			for _, packet := range frame.packets {
				select {
				case <-d.done:
					return
				default:
				}
				// Resequence before Pion's NACK/RTCP interceptors. Intentionally
				// skipped frames must not trigger requests for unsent packets.
				if !d.haveSequence {
					d.sequence = packet.SequenceNumber
					d.haveSequence = true
				}
				copy := *packet
				copy.Header = packet.Header.Clone()
				copy.SequenceNumber = d.sequence
				d.sequence++
				if err := d.write(&copy); err != nil {
					d.mu.Lock()
					d.stats.Failed = true
					d.mu.Unlock()
					d.close()
					return
				}
			}
			d.mu.Lock()
			d.stats.Written++
			if ms := float64(wait) / float64(time.Millisecond); ms > d.stats.MaxQueueMs {
				d.stats.MaxQueueMs = ms
			}
			d.mu.Unlock()
		}
	}
}
func (d *mediaDelivery) snapshot() deliveryStats {
	d.mu.Lock()
	defer d.mu.Unlock()
	stats := d.stats
	stats.Pending = len(d.pending)
	stats.WaitingKey = d.waitingKey
	return stats
}
func (d *mediaDelivery) close() {
	d.mu.Lock()
	defer d.mu.Unlock()
	if !d.closed {
		d.closed = true
		d.pending = nil
		close(d.done)
	}
}

type mediaFanout struct {
	mu      sync.Mutex
	viewers map[*mediaDelivery]struct{}
	// A newly connected viewer also needs a picture when a captured app is
	// completely idle. Retain one bounded decode chain, never a playback queue.
	bootstrap                       []*rtp.Packet
	bootstrapBytes, bootstrapFrames int
	bootstrapAt                     time.Time
}

func (h *mediaFanout) subscribe(template *webrtc.TrackLocalStaticRTP) (*mediaDelivery, error) {
	track, err := webrtc.NewTrackLocalStaticRTP(template.Codec(), template.ID(), template.StreamID())
	if err != nil {
		return nil, err
	}
	d := newDelivery(template.Kind() == webrtc.RTPCodecTypeVideo, track.WriteRTP)
	d.track = track
	h.mu.Lock()
	h.viewers[d] = struct{}{}
	h.mu.Unlock()
	return d, nil
}
func (h *mediaFanout) remove(d *mediaDelivery) {
	if d == nil {
		return
	}
	h.mu.Lock()
	delete(h.viewers, d)
	h.mu.Unlock()
	d.close()
}
func (h *mediaFanout) publish(frame *encodedFrame) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.bootstrapAt = frame.at
	if frame.key {
		h.bootstrap = nil
		h.bootstrapBytes = 0
		h.bootstrapFrames = 0
	}
	if frame.key || len(h.bootstrap) > 0 {
		h.bootstrapFrames++
		for _, packet := range frame.packets {
			h.bootstrap = append(h.bootstrap, packet)
			h.bootstrapBytes += len(packet.Payload)
		}
		if h.bootstrapBytes > 8*1024*1024 || len(h.bootstrap) > 8192 || h.bootstrapFrames > 240 {
			h.bootstrap = nil
			h.bootstrapBytes = 0
			h.bootstrapFrames = 0
		}
	}
	for d := range h.viewers {
		d.offer(frame)
	}
}

// Prime only this viewer after DTLS connects. Existing viewers continue live
// delivery, and the source encoder never restarts for a new connection.
func (h *mediaFanout) prime(d *mediaDelivery) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.viewers[d]; !ok {
		return
	}
	d.invalidate()
	// A live source will provide a fresh IDR within its bounded GOP. Replaying
	// an older decode chain establishes an old receiver clock and can cause a
	// visible one-second pause when the live timestamps arrive. Only idle
	// sources need their retained picture; quality handovers keep the old
	// transport running while waiting for the fresh keyframe.
	if len(h.bootstrap) == 0 || time.Since(h.bootstrapAt) < 150*time.Millisecond {
		return
	}
	packets := append([]*rtp.Packet(nil), h.bootstrap...)
	d.offer(&encodedFrame{packets: packets, at: time.Now(), key: true})
}
func (h *mediaFanout) invalidate() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.bootstrap = nil
	h.bootstrapBytes = 0
	h.bootstrapFrames = 0
	h.bootstrapAt = time.Time{}
	for d := range h.viewers {
		d.invalidate()
	}
}
