package main

import (
	"bytes"
	"github.com/pion/interceptor"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
	"strings"
	"testing"
)

func TestPlayoutDelayIsVideoOnlyNegotiatedAndPeerLocal(t *testing.T) {
	shared := &rtp.Header{Version: 2, SSRC: 123}
	if err := shared.SetExtension(8, []byte{7}); err != nil {
		t.Fatal(err)
	}
	for _, id := range []int{3, 5} {
		seen := false
		writer := interceptor.RTPWriterFunc(func(header *rtp.Header, payload []byte, _ interceptor.Attributes) (int, error) {
			seen = true
			if !bytes.Equal(header.GetExtension(uint8(id)), []byte{0, 0, 0}) || !bytes.Equal(header.GetExtension(8), []byte{7}) {
				t.Fatal("Missing negotiated delay or damaged existing headers")
			}
			header.GetExtension(8)[0] = 42
			return len(payload), nil
		})
		stream := &interceptor.StreamInfo{MimeType: webrtc.MimeTypeH264, RTPHeaderExtensions: []interceptor.RTPHeaderExtension{{URI: playoutDelayURI, ID: id}}}
		output := (&playoutDelayInterceptor{}).BindLocalStream(stream, writer)
		if _, err := output.Write(shared, []byte{1}, nil); err != nil {
			t.Fatal(err)
		}
		if !seen || len(shared.GetExtensionIDs()) != 1 || shared.GetExtension(8)[0] != 7 {
			t.Fatal("Shared multi-peer RTP header was mutated")
		}
	}
	for _, info := range []*interceptor.StreamInfo{{MimeType: webrtc.MimeTypeH264}, {MimeType: webrtc.MimeTypeOpus, RTPHeaderExtensions: []interceptor.RTPHeaderExtension{{URI: playoutDelayURI, ID: 3}}}} {
		writer := interceptor.RTPWriterFunc(func(header *rtp.Header, payload []byte, _ interceptor.Attributes) (int, error) {
			if header != shared {
				t.Fatal("Audio or unnegotiated packets must pass unchanged")
			}
			return len(payload), nil
		})
		if _, err := (&playoutDelayInterceptor{}).BindLocalStream(info, writer).Write(shared, nil, nil); err != nil {
			t.Fatal(err)
		}
	}
}

func TestPlayoutDelayOfferCanBeDisabled(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		api, err := mediaAPI(webrtc.SettingEngine{}, enabled)
		if err != nil {
			t.Fatal(err)
		}
		pc, err := api.NewPeerConnection(webrtc.Configuration{})
		if err != nil {
			t.Fatal(err)
		}
		if _, err = pc.AddTransceiverFromKind(webrtc.RTPCodecTypeVideo); err != nil {
			t.Fatal(err)
		}
		offer, err := pc.CreateOffer(nil)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(offer.SDP, playoutDelayURI) != enabled {
			t.Fatal("Incorrect playout extension offer")
		}
		pc.Close()
	}
}

func TestAudioDoesNotShareVideoSyncGroup(t *testing.T) {
	video, err := makeSource("test-video")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { video.conn.Close(); delete(sources, "test-video") }()
	audio, err := makeSource("__audio")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { audio.conn.Close(); delete(sources, "__audio") }()
	if video.track.StreamID() == audio.track.StreamID() {
		t.Fatal("audio must not hold video in a shared synchronization group")
	}
}
