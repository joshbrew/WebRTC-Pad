package main

import (
	"errors"
	"testing"
	"time"

	"github.com/pion/rtp"
)

func testPacket(seq uint16, timestamp uint32, marker bool, payload ...byte) *rtp.Packet {
	return &rtp.Packet{Header: rtp.Header{Version: 2, SequenceNumber: seq, Timestamp: timestamp, SSRC: 7, Marker: marker}, Payload: payload}
}
func testFrame(seq uint16, key bool) *encodedFrame {
	value := byte(0x61)
	if key {
		value = 0x65
	}
	return &encodedFrame{packets: []*rtp.Packet{testPacket(seq, uint32(seq)*3000, true, value, 1)}, at: time.Now(), key: key}
}
func receive(t *testing.T, packets <-chan *rtp.Packet) *rtp.Packet {
	t.Helper()
	select {
	case packet := <-packets:
		return packet
	case <-time.After(2 * time.Second):
		t.Fatal("packet did not arrive")
		return nil
	}
}
func stopDelivery(t *testing.T, d *mediaDelivery) {
	t.Helper()
	d.close()
	select {
	case <-d.stopped:
	case <-time.After(time.Second):
		t.Error("delivery did not stop")
	}
}

func TestAssemblerOwnsCompleteFramesAndHandlesIDRPacketization(t *testing.T) {
	a := &frameAssembler{}
	now := time.Now()
	first := testPacket(65535, 30, false, 0x67, 2)
	if frame, gap := a.push(first, now); frame != nil || gap {
		t.Fatal("must await only this frame's marker")
	}
	first.Payload[1] = 99
	frame, gap := a.push(testPacket(0, 30, true, 28, 0x85, 3), now)
	if frame == nil || !frame.key || gap || len(frame.packets) != 2 || frame.packets[0].Payload[1] != 2 {
		t.Fatal("IDR FU-A, wrapping sequence or UDP copy failed")
	}
	if !randomAccess([]byte{24, 0, 2, 0x67, 1, 0, 2, 0x65, 2}) || randomAccess([]byte{24, 0, 8, 0x65}) || randomAccess([]byte{28, 0x05, 2}) {
		t.Fatal("incorrect aggregation/fragmented IDR detection")
	}
	if value, gap := a.push(testPacket(2, 40, true, 0x61, 1), now); value != nil || !gap {
		t.Fatal("missing source packets cannot form a valid frame")
	}
	if value, gap := a.push(testPacket(3, 50, true, 0x65, 1), now); value == nil || gap || !value.key {
		t.Fatal("next complete IDR must recover")
	}
	if value, _ := a.push(testPacket(4, 60, false, 0x61, 1), now); value != nil {
		t.Fatal("premature frame")
	}
	if value, gap := a.push(testPacket(5, 70, true, 0x61, 1), now); value != nil || !gap {
		t.Fatal("missing marker must invalidate partial frames")
	}
}

func TestBlockedViewerDoesNotDelayHealthyViewerAndRecoversAtKeyframe(t *testing.T) {
	blocked, release := make(chan struct{}), make(chan struct{})
	slowPackets := make(chan *rtp.Packet, 10)
	slow := newDelivery(true, func(p *rtp.Packet) error {
		select {
		case <-blocked:
		default:
			close(blocked)
			<-release
		}
		slowPackets <- p.Clone()
		return nil
	})
	fastPackets := make(chan *rtp.Packet, 200)
	fast := newDelivery(true, func(p *rtp.Packet) error { fastPackets <- p.Clone(); return nil })
	hub := &mediaFanout{viewers: map[*mediaDelivery]struct{}{slow: {}, fast: {}}}
	defer stopDelivery(t, fast)
	defer stopDelivery(t, slow)
	defer close(release)
	first := testFrame(100, true)
	hub.publish(first)
	<-blocked
	receive(t, fastPackets)
	for seq := uint16(101); seq < 121; seq++ {
		hub.publish(testFrame(seq, false))
		receive(t, fastPackets)
	}
	stats := slow.snapshot()
	if stats.Pending > maxQueuedFrames || stats.Dropped == 0 || !stats.WaitingKey {
		t.Fatalf("unbounded/undecodable slow queue: %+v", stats)
	}
	if fast.snapshot().Dropped != 0 {
		t.Fatal("slow viewer damaged fast viewer")
	}
	// Release the blocked write, then resume with a clean IDR and contiguous
	// per-viewer sequence numbers; the source headers must remain unchanged.
	release <- struct{}{} // release channel is also closed by cleanup
	receive(t, slowPackets)
	key := testFrame(200, true)
	hub.publish(key)
	out := receive(t, slowPackets)
	if out.SequenceNumber != 101 || key.packets[0].SequenceNumber != 200 || first.packets[0].SequenceNumber != 100 {
		t.Fatal("skips created NACK gaps or modified shared packets")
	}
}

func TestStaleFramesWaitForFreshKeyframeAndAudioDoesNot(t *testing.T) {
	packets := make(chan *rtp.Packet, 10)
	video := newDelivery(true, func(p *rtp.Packet) error { packets <- p.Clone(); return nil })
	defer stopDelivery(t, video)
	stale := testFrame(1, true)
	stale.at = time.Now().Add(-time.Second)
	video.offer(stale)
	deadline := time.Now().Add(time.Second)
	for video.snapshot().Dropped == 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	video.offer(testFrame(2, false))
	video.offer(testFrame(3, true))
	out := receive(t, packets)
	if out.Timestamp != 9000 || video.snapshot().Dropped < 2 {
		t.Fatal("stale/dependent video was replayed")
	}
	audioPackets := make(chan *rtp.Packet, 10)
	audio := newDelivery(false, func(p *rtp.Packet) error { audioPackets <- p.Clone(); return nil })
	defer stopDelivery(t, audio)
	audio.offer(testFrame(4, false))
	if receive(t, audioPackets).Timestamp != 12000 {
		t.Fatal("audio must not wait for a video keyframe")
	}
}

func TestDeliveryWriteFailureAndCloseReleaseQueue(t *testing.T) {
	d := newDelivery(true, func(*rtp.Packet) error { return errors.New("disconnected") })
	d.offer(testFrame(1, true))
	select {
	case <-d.stopped:
	case <-time.After(time.Second):
		t.Fatal("writer error leaked worker")
	}
	d.offer(testFrame(2, true))
	if stats := d.snapshot(); !stats.Failed || stats.Pending != 0 {
		t.Fatalf("failed writer retained frames: %+v", stats)
	}
}

func TestHEVCCompleteAccessUnitsAndSourceProfileIsolation(t *testing.T) {
	a := &frameAssembler{hevc: true}
	now := time.Now()
	frame, gap := a.push(testPacket(1, 90, true, 49<<1, 1, 0x80|19, 2), now)
	if gap || frame == nil || !frame.key {
		t.Fatal("HEVC IDR fragment was not recognized")
	}
	if !hevcRandomAccess([]byte{48 << 1, 1, 0, 3, 19 << 1, 1, 2}) || hevcRandomAccess([]byte{48 << 1, 1, 0, 9, 19 << 1}) {
		t.Fatal("HEVC aggregation validation failed")
	}
	s, err := makeSource("hevc-profile-test", "h265")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { s.conn.Close(); delete(sources, "hevc-profile-test") }()
	if s.track.Codec().MimeType != "video/H265" {
		t.Fatal("H.265 source advertised the wrong codec")
	}
	if _, err := makeSource("hevc-profile-test", "h264"); err == nil {
		t.Fatal("different codec reused existing source")
	}
}

func TestIdleSourcePrimesNewViewerWithoutWaitingForNewCapture(t *testing.T) {
	hub := &mediaFanout{viewers: map[*mediaDelivery]struct{}{}}
	first, last := testFrame(10, true), testFrame(11, false)
	first.at = time.Now().Add(-time.Minute)
	last.at = first.at
	hub.publish(first)
	hub.publish(last)
	packets := make(chan *rtp.Packet, 10)
	viewer := newDelivery(true, func(p *rtp.Packet) error { packets <- p.Clone(); return nil })
	defer stopDelivery(t, viewer)
	hub.viewers[viewer] = struct{}{}
	hub.prime(viewer)
	if receive(t, packets).Timestamp != first.packets[0].Timestamp || receive(t, packets).Timestamp != last.packets[0].Timestamp {
		t.Fatal("Must replay the complete decode chain only to the joining viewer")
	}
	hub.invalidate()
	hub.prime(viewer)
	select {
	case <-packets:
		t.Fatal("Invalidated source packets cannot be replayed")
	case <-time.After(20 * time.Millisecond):
	}
}

func TestJoinPictureCacheIsBoundedAndStartsAtAnIDR(t *testing.T) {
	hub := &mediaFanout{viewers: map[*mediaDelivery]struct{}{}}
	hub.publish(testFrame(1, false))
	if len(hub.bootstrap) != 0 {
		t.Fatal("A delta frame is not a valid startup picture")
	}
	hub.publish(testFrame(2, true))
	for i := 0; i < 240; i++ {
		hub.publish(testFrame(uint16(3+i), false))
	}
	if len(hub.bootstrap) != 0 {
		t.Fatal("Decode chain must stay bounded")
	}
	hub.publish(testFrame(300, true))
	if len(hub.bootstrap) != 1 {
		t.Fatal("A new IDR must replace the old chain")
	}
}

func TestActiveSourceWaitsForFreshKeyframeInsteadOfReplayingOldTimestamps(t *testing.T) {
	hub := &mediaFanout{viewers: map[*mediaDelivery]struct{}{}}
	hub.publish(testFrame(1, true))
	packets := make(chan *rtp.Packet, 10)
	viewer := newDelivery(true, func(p *rtp.Packet) error { packets <- p.Clone(); return nil })
	defer stopDelivery(t, viewer)
	hub.viewers[viewer] = struct{}{}
	hub.prime(viewer)
	hub.publish(testFrame(2, false))
	select {
	case <-packets:
		t.Fatal("Active startup must not replay cached frames or send undecodable delta frames")
	case <-time.After(20 * time.Millisecond):
	}
	hub.publish(testFrame(3, true))
	if receive(t, packets).Timestamp != 9000 {
		t.Fatal("The viewer must start at the next live keyframe")
	}
}
