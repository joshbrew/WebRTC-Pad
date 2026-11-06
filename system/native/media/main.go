// Encoded H.264 RTP -> WebRTC. Raw desktop frames never enter Node/browser JS.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"sync"
	"time"

	"github.com/pion/interceptor"
	"github.com/pion/interceptor/pkg/nack"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

type source struct {
	conn   *net.UDPConn
	track  *webrtc.TrackLocalStaticRTP
	fanout *mediaFanout
	refs   int
}
type peer struct {
	pc            *webrtc.PeerConnection
	profile       string
	audio         bool
	videoDelivery *mediaDelivery
	audioDelivery *mediaDelivery
}
type request struct {
	ID        string                    `json:"id"`
	Type      string                    `json:"type"`
	PeerID    string                    `json:"peerId"`
	Profile   string                    `json:"profile"`
	ICE       webrtc.Configuration      `json:"ice"`
	SDP       webrtc.SessionDescription `json:"sdp"`
	AudioOnly bool                      `json:"audioOnly"`
	Audio     bool                      `json:"audio"`
	Candidate webrtc.ICECandidateInit   `json:"candidate"`
	Codec     string                    `json:"codec"`
}

var output sync.Mutex
var sources = map[string]*source{}
var peers = map[string]*peer{}

const playoutDelayURI = "http://www.webrtc.org/experiments/rtp-hdrext/playout-delay"

// A zero maximum asks the browser's video renderer for interactive playout,
// beyond the receive-side jitter-buffer hint. Only negotiated video streams
// receive it. Default NACK/report interceptors remain in the pipeline.
type playoutDelayFactory struct{}
type playoutDelayInterceptor struct{ interceptor.NoOp }

func (playoutDelayFactory) NewInterceptor(string) (interceptor.Interceptor, error) {
	return &playoutDelayInterceptor{}, nil
}
func (*playoutDelayInterceptor) BindLocalStream(info *interceptor.StreamInfo, writer interceptor.RTPWriter) interceptor.RTPWriter {
	if info.MimeType != webrtc.MimeTypeH264 && info.MimeType != webrtc.MimeTypeH265 {
		return writer
	}
	for _, extension := range info.RTPHeaderExtensions {
		if extension.URI == playoutDelayURI && extension.ID > 0 && extension.ID < 256 {
			id := uint8(extension.ID)
			return interceptor.RTPWriterFunc(func(header *rtp.Header, payload []byte, attributes interceptor.Attributes) (int, error) {
				// Source packets are shared across peers, whose negotiated IDs can
				// differ. Never alter the shared packet or another peer's headers.
				copy := header.Clone()
				if err := copy.SetExtension(id, []byte{0, 0, 0}); err != nil {
					return 0, err
				}
				return writer.Write(&copy, payload, attributes)
			})
		}
	}
	return writer
}
func mediaAPI(settings webrtc.SettingEngine, immediate bool) (*webrtc.API, error) {
	m := &webrtc.MediaEngine{}
	if err := m.RegisterDefaultCodecs(); err != nil {
		return nil, err
	}
	if immediate {
		if err := m.RegisterHeaderExtension(webrtc.RTPHeaderExtensionCapability{URI: playoutDelayURI}, webrtc.RTPCodecTypeVideo); err != nil {
			return nil, err
		}
	}
	registry := &interceptor.Registry{}
	// Keep enough sent packets to repair a high-bitrate IDR over a remote
	// route. This is a retransmission cache, never added playout latency.
	if err := webrtc.RegisterDefaultInterceptorsWithOptions(m, registry, webrtc.WithNackResponderOptions(nack.ResponderSize(2048))); err != nil {
		return nil, err
	}
	if immediate {
		registry.Add(playoutDelayFactory{})
	}
	return webrtc.NewAPI(webrtc.WithSettingEngine(settings), webrtc.WithMediaEngine(m), webrtc.WithInterceptorRegistry(registry)), nil
}

func emit(value any) {
	output.Lock()
	defer output.Unlock()
	_ = json.NewEncoder(os.Stdout).Encode(value)
}
func makeSource(profile string, codecNames ...string) (*source, error) {
	name := "h264"
	if len(codecNames) > 0 && codecNames[0] != "" {
		name = codecNames[0]
	}
	if name != "h264" && name != "h265" {
		return nil, fmt.Errorf("unsupported native codec")
	}
	if s := sources[profile]; s != nil {
		if profile != "__audio" && (s.track.Codec().MimeType == webrtc.MimeTypeH265) != (name == "h265") {
			return nil, fmt.Errorf("source codec does not match shared profile")
		}
		return s, nil
	}
	conn, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.ParseIP("127.0.0.1")})
	if err != nil {
		return nil, err
	}
	// Whole encoded frames arrive in short local UDP bursts. The tiny default
	// Windows socket buffer can lose part of an IDR even on loopback.
	_ = conn.SetReadBuffer(4 * 1024 * 1024)
	codec := webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeH264, ClockRate: 90000, SDPFmtpLine: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f"}
	kind := "video"
	if name == "h265" {
		codec = webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeH265, ClockRate: 90000}
	}
	if profile == "__audio" {
		codec = webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeOpus, ClockRate: 48000, Channels: 2, SDPFmtpLine: "minptime=10;useinbandfec=1;stereo=1"}
		kind = "audio"
	}
	streamID := "native-desktop"
	if kind == "audio" {
		streamID = "native-audio"
	}
	track, err := webrtc.NewTrackLocalStaticRTP(codec, kind, streamID)
	if err != nil {
		conn.Close()
		return nil, err
	}
	s := &source{conn: conn, track: track, fanout: &mediaFanout{viewers: map[*mediaDelivery]struct{}{}}}
	sources[profile] = s
	go func() {
		data := make([]byte, 2048)
		clock := time.Now()
		var audioSSRC, audioOffset, lastTimestamp uint32
		var audioSequence uint16
		haveAudio := false
		assembler := &frameAssembler{hevc: name == "h265"}
		for {
			n, _, err := conn.ReadFromUDP(data)
			if err != nil {
				return
			}
			packet := &rtp.Packet{}
			if packet.Unmarshal(data[:n]) == nil {
				if profile == "__audio" {
					// FFmpeg restarts when sound is toggled. Keep one RTP timeline
					// for existing receivers across those source SSRC/sequence resets.
					if !haveAudio || packet.SSRC != audioSSRC {
						next := uint32(time.Since(clock).Seconds() * 48000)
						if haveAudio && int32(next-lastTimestamp) < 480 {
							next = lastTimestamp + 480
						}
						audioSSRC, audioOffset, haveAudio = packet.SSRC, next-packet.Timestamp, true
					}
					packet.Timestamp += audioOffset
					lastTimestamp = packet.Timestamp
					packet.SequenceNumber = audioSequence
					audioSequence++
				}
				if profile == "__audio" {
					s.fanout.publish(&encodedFrame{packets: []*rtp.Packet{packet.Clone()}, at: time.Now()})
				} else {
					frame, gap := assembler.push(packet, time.Now())
					if gap {
						s.fanout.invalidate()
					}
					if frame != nil {
						s.fanout.publish(frame)
					}
				}
			}
		}
	}()
	return s, nil
}
func closePeer(id string) {
	p := peers[id]
	if p == nil {
		return
	}
	delete(peers, id)
	if s := sources[p.profile]; s != nil {
		s.fanout.remove(p.videoDelivery)
	}
	if s := sources["__audio"]; s != nil {
		s.fanout.remove(p.audioDelivery)
	}
	// Stop network I/O before Track.Unbind waits on an in-flight RTP writer.
	// A blocked TURN/TCP path must not hold the helper's command loop open.
	if transport := p.pc.SCTP(); transport != nil {
		_ = transport.Transport().ICETransport().Stop()
	}
	_ = p.pc.Close()
	keys := []string{p.profile}
	if p.audio {
		keys = append(keys, "__audio")
	}
	for _, key := range keys {
		if s := sources[key]; s != nil {
			s.refs--
			if s.refs == 0 {
				_ = s.conn.Close()
				delete(sources, key)
			}
		}
	}
}
func handle(r request) (any, error) {
	switch r.Type {
	case "offer":
		closePeer(r.PeerID)
		settings := webrtc.SettingEngine{}
		settings.SetSTUNGatherTimeout(8 * time.Second)
		api, err := mediaAPI(settings, os.Getenv("NATIVE_PLAYOUT_DELAY") != "0")
		if err != nil {
			return nil, err
		}
		pc, err := api.NewPeerConnection(r.ICE)
		if err != nil {
			return nil, err
		}
		var sender *webrtc.RTPSender
		var videoSource *source
		port := 0
		p := &peer{pc: pc}
		peers[r.PeerID] = p
		if !r.AudioOnly {
			s, sourceErr := makeSource(r.Profile, r.Codec)
			if sourceErr != nil {
				closePeer(r.PeerID)
				return nil, sourceErr
			}
			videoSource = s
			s.refs++
			p.profile = r.Profile
			p.videoDelivery, err = s.fanout.subscribe(s.track)
			if err != nil {
				closePeer(r.PeerID)
				return nil, err
			}
			sender, err = pc.AddTrack(p.videoDelivery.track)
			if err != nil {
				closePeer(r.PeerID)
				return nil, err
			}
			port = s.conn.LocalAddr().(*net.UDPAddr).Port
		}
		audioPort := 0
		if r.Audio {
			a, err := makeSource("__audio")
			if err != nil {
				closePeer(r.PeerID)
				return nil, err
			}
			a.refs++
			p.audio = true
			p.audioDelivery, err = a.fanout.subscribe(a.track)
			if err != nil {
				closePeer(r.PeerID)
				return nil, err
			}
			audioSender, err := pc.AddTrack(p.audioDelivery.track)
			if err != nil {
				closePeer(r.PeerID)
				return nil, err
			}
			audioPort = a.conn.LocalAddr().(*net.UDPAddr).Port
			go func() {
				data := make([]byte, 1500)
				for {
					if _, _, err := audioSender.Read(data); err != nil {
						return
					}
				}
			}()
		}
		pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
			if state == webrtc.PeerConnectionStateConnected && videoSource != nil {
				videoSource.fanout.prime(p.videoDelivery)
			}
			emit(map[string]any{"event": "state", "peerId": r.PeerID, "state": state.String()})
		})
		if sender != nil {
			go func() {
				data := make([]byte, 1500)
				for {
					if _, _, err := sender.Read(data); err != nil {
						return
					}
				}
			}()
		}
		emit(map[string]any{"event": "source-ready", "requestId": r.ID, "port": port, "audioPort": audioPort})
		offer, err := pc.CreateOffer(nil)
		if err != nil {
			closePeer(r.PeerID)
			return nil, err
		}
		gathered := webrtc.GatheringCompletePromise(pc)
		if err = pc.SetLocalDescription(offer); err != nil {
			closePeer(r.PeerID)
			return nil, err
		}
		select {
		case <-gathered:
		case <-time.After(30 * time.Second):
			closePeer(r.PeerID)
			return nil, fmt.Errorf("native ICE gathering timed out")
		}
		codec := "h264"
		if r.Codec == "h265" {
			codec = "h265"
		}
		return map[string]any{"sdp": pc.LocalDescription(), "port": port, "profile": r.Profile, "audioPort": audioPort, "audioOnly": r.AudioOnly, "codec": codec}, nil
	case "answer":
		p := peers[r.PeerID]
		if p == nil {
			return nil, fmt.Errorf("native peer is no longer active")
		}
		return nil, p.pc.SetRemoteDescription(r.SDP)
	case "ice":
		p := peers[r.PeerID]
		if p == nil {
			return nil, fmt.Errorf("native peer is no longer active")
		}
		return nil, p.pc.AddICECandidate(r.Candidate)
	case "close":
		closePeer(r.PeerID)
		return nil, nil
	case "stats":
		p := peers[r.PeerID]
		if p == nil {
			return nil, fmt.Errorf("native peer is no longer active")
		}
		stats := map[string]any{}
		if p.videoDelivery != nil {
			stats["video"] = p.videoDelivery.snapshot()
		}
		if p.audioDelivery != nil {
			stats["audio"] = p.audioDelivery.snapshot()
		}
		return stats, nil
	default:
		return nil, fmt.Errorf("unknown native media command")
	}
}
func main() {
	emit(map[string]any{"event": "ready"})
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 4096), 256*1024)
	for scanner.Scan() {
		var r request
		if err := json.Unmarshal(scanner.Bytes(), &r); err != nil {
			var envelope struct {
				ID string `json:"id"`
			}
			_ = json.Unmarshal(scanner.Bytes(), &envelope)
			emit(map[string]any{"id": envelope.ID, "error": "Invalid native request: " + err.Error()})
			continue
		}
		value, err := handle(r)
		response := map[string]any{"id": r.ID, "result": value}
		if err != nil {
			response["error"] = err.Error()
		}
		emit(response)
	}
	for id := range peers {
		closePeer(id)
	}
}
