package tools

import (
	"bytes"
	"encoding/binary"
	"hash/crc32"
	"os"
	"path/filepath"
	"testing"
)

func hugePNG(t *testing.T, width, height uint32) string {
	t.Helper()
	var buf bytes.Buffer
	buf.Write([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'})
	chunk := func(kind string, data []byte) {
		var length [4]byte
		binary.BigEndian.PutUint32(length[:], uint32(len(data)))
		buf.Write(length[:])
		buf.WriteString(kind)
		buf.Write(data)
		crc := crc32.NewIEEE()
		crc.Write([]byte(kind))
		crc.Write(data)
		var sum [4]byte
		binary.BigEndian.PutUint32(sum[:], crc.Sum32())
		buf.Write(sum[:])
	}
	ihdr := make([]byte, 13)
	binary.BigEndian.PutUint32(ihdr[0:], width)
	binary.BigEndian.PutUint32(ihdr[4:], height)
	ihdr[8] = 8 // bit depth
	ihdr[9] = 2 // truecolour
	chunk("IHDR", ihdr)
	chunk("IEND", nil)
	path := filepath.Join(t.TempDir(), "huge.png")
	if err := os.WriteFile(path, buf.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestDecodeImageRejectsHugeDimensions(t *testing.T) {
	path := hugePNG(t, 100_000, 100_000)
	if _, err := decodeImage(path); err == nil {
		t.Fatal("decodeImage accepted a 10-gigapixel image")
	}
	if _, _, err := decodeImageConfig(path); err == nil {
		t.Fatal("decodeImageConfig accepted a 10-gigapixel image")
	}
}
