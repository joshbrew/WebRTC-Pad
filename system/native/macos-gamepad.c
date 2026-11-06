// Uses the system IOHIDUserDevice API, not an unsigned kernel extension.
// Build and signing requirements are in README.md. Device creation may require
// Apple's com.apple.developer.hid.virtual.device entitlement on the target OS.
#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/IOReturn.h>
#include <poll.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

// These exported IOKit functions are not declared by all public SDK headers.
typedef struct __IOHIDUserDevice *IOHIDUserDeviceRef;
extern IOHIDUserDeviceRef IOHIDUserDeviceCreate(CFAllocatorRef, CFDictionaryRef);
extern IOReturn IOHIDUserDeviceHandleReport(IOHIDUserDeviceRef, const uint8_t *, CFIndex);

// 16 buttons, 8-way hat with null=8, X/Y/Rx/Ry/Z/Rz bytes, padding.
static const uint8_t descriptor[] = {
    0x05,0x01,0x09,0x05,0xa1,0x01,
    0x05,0x09,0x19,0x01,0x29,0x10,0x15,0x00,0x25,0x01,0x75,0x01,0x95,0x10,0x81,0x02,
    0x05,0x01,0x09,0x39,0x15,0x00,0x25,0x07,0x35,0x00,0x46,0x3b,0x01,0x65,0x14,
    0x75,0x04,0x95,0x01,0x81,0x42,0x65,0x00,0x75,0x04,0x95,0x01,0x81,0x03,
    0x09,0x30,0x09,0x31,0x09,0x33,0x09,0x34,0x09,0x32,0x09,0x35,
    0x15,0x00,0x26,0xff,0x00,0x35,0x00,0x46,0xff,0x00,0x75,0x08,0x95,0x06,0x81,0x02,
    0x75,0x08,0x95,0x01,0x81,0x03,0xc0
};
static const uint8_t neutral[10] = {0,0,8,128,128,128,128,0,0,0};
static double now(void) {
    struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t);
    return t.tv_sec + t.tv_nsec / 1e9;
}
static void number(CFMutableDictionaryRef dict, CFStringRef key, int value) {
    CFNumberRef n = CFNumberCreate(NULL, kCFNumberIntType, &value);
    CFDictionarySetValue(dict, key, n); CFRelease(n);
}
static IOHIDUserDeviceRef create(int player) {
    CFMutableDictionaryRef props = CFDictionaryCreateMutable(NULL, 0, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    CFDataRef data = CFDataCreate(NULL, descriptor, sizeof(descriptor));
    CFDictionarySetValue(props, CFSTR("ReportDescriptor"), data); CFRelease(data);
    CFStringRef name = CFStringCreateWithFormat(NULL, NULL, CFSTR("WebRTC Pad P%d"), player + 1);
    CFDictionarySetValue(props, CFSTR("Product"), name); CFRelease(name);
    CFDictionarySetValue(props, CFSTR("Transport"), CFSTR("Virtual"));
    CFStringRef serial = CFStringCreateWithFormat(NULL, NULL, CFSTR("webrtc-pad-%d"), player + 1);
    CFDictionarySetValue(props, CFSTR("SerialNumber"), serial); CFRelease(serial);
    number(props, CFSTR("VendorID"), 0x1209); number(props, CFSTR("ProductID"), 0x0001);
    number(props, CFSTR("PrimaryUsagePage"), 1); number(props, CFSTR("PrimaryUsage"), 5);
    IOHIDUserDeviceRef device = IOHIDUserDeviceCreate(NULL, props); CFRelease(props);
    return device;
}
static int submit(IOHIDUserDeviceRef pad, const uint8_t *report) {
    IOReturn result = IOHIDUserDeviceHandleReport(pad, report, 10);
    if (result != kIOReturnSuccess) { fprintf(stderr, "Virtual HID report failed: 0x%x\n", result); return 0; }
    return 1;
}
typedef struct { IOHIDUserDeviceRef pad; double updated; } Device;
static int grow(Device **devices, size_t *capacity, size_t needed) {
    if (needed <= *capacity) return 1;
    size_t next = *capacity ? *capacity : 8;
    while (next < needed) { if (next > SIZE_MAX / 2) return 0; next *= 2; }
    if (next > SIZE_MAX / sizeof(Device)) return 0;
    Device *expanded = realloc(*devices, next * sizeof(Device));
    if (!expanded) return 0;
    memset(expanded + *capacity, 0, (next - *capacity) * sizeof(Device));
    *devices = expanded; *capacity = next; return 1;
}
int main(int argc, char **argv) {
    int count = argc > 1 ? atoi(argv[1]) : 4;
    if (count < 0) { fprintf(stderr, "Initial player count must not be negative\n"); return 1; }
    Device *devices = NULL; size_t capacity = 0; int result = 1;
    if (!grow(&devices, &capacity, (size_t)count)) { fprintf(stderr, "Not enough memory for controllers\n"); return 1; }
    for (int i = 0; i < count; i++) {
        devices[i].pad = create(i);
        if (!devices[i].pad) { fprintf(stderr, "macOS denied virtual HID creation. Build and sign the helper with the Apple-authorized HID entitlement; see README.md.\n"); goto cleanup; }
        if (!submit(devices[i].pad, neutral)) goto cleanup;
    }
    puts("READY"); fflush(stdout);
    char buffer[4096]; size_t used = 0;
    struct pollfd input = {STDIN_FILENO, POLLIN, 0};
    for (;;) {
        int polled = poll(&input, 1, 100);
        if (polled < 0) goto cleanup;
        if (polled > 0 && (input.revents & (POLLIN | POLLHUP))) {
            ssize_t received = read(STDIN_FILENO, buffer + used, sizeof(buffer) - used - 1);
            if (received <= 0) { result = received == 0 ? 0 : 1; break; }
            used += (size_t)received; buffer[used] = 0;
            char *end;
            while ((end = strchr(buffer, '\n'))) {
                *end = 0;
                unsigned player; char hex[21], extra;
                char operation[8]; unsigned request;
                if(sscanf(buffer,"%7s %u p%u%c",operation,&request,&player,&extra)==3 && (!strcmp(operation,"add") || !strcmp(operation,"remove"))) {
                    const char *error = NULL;
                    if(player<1)error="Invalid controller slot";
                    else if(!strcmp(operation,"add") && !grow(&devices,&capacity,(size_t)player))error="Not enough memory for another controller";
                    else if(!strcmp(operation,"remove") && (size_t)player>capacity) { /* Already absent. */ }
                    else {
                        size_t slot=(size_t)player-1;
                        if(!strcmp(operation,"add") && !devices[slot].pad) {
                            devices[slot].pad=create(slot);
                            if(!devices[slot].pad)error="macOS denied virtual HID creation; check signing and entitlement";
                            else if(!submit(devices[slot].pad,neutral)){CFRelease(devices[slot].pad);devices[slot].pad=NULL;error="Virtual HID report failed";}
                        }
                        if(!strcmp(operation,"remove") && devices[slot].pad){submit(devices[slot].pad,neutral);CFRelease(devices[slot].pad);devices[slot].pad=NULL;devices[slot].updated=0;}
                    }
                    if(error)printf("{\"id\":%u,\"error\":\"%s\"}\n",request,error);else printf("{\"id\":%u}\n",request);
                    fflush(stdout);
                    size_t consumed=(size_t)(end-buffer)+1;memmove(buffer,end+1,used-consumed);used-=consumed;buffer[used]=0;
                    continue;
                }
                if (sscanf(buffer, "p%u %20[0-9a-fA-F]%c", &player, hex, &extra) != 2 || strlen(hex) != 20 || player < 1 || (size_t)player > capacity) goto cleanup;
                size_t slot = (size_t)player - 1; uint8_t report[10];
                for (int i = 0; i < 10; i++) {
                    unsigned value;
                    if (sscanf(hex + i * 2, "%2x", &value) != 1) goto cleanup;
                    report[i] = (uint8_t)value;
                }
                if(devices[slot].pad) {if (!submit(devices[slot].pad, report)) goto cleanup;devices[slot].updated = now();}
                size_t consumed = (size_t)(end - buffer) + 1;
                memmove(buffer, end + 1, used - consumed); used -= consumed; buffer[used] = 0;
            }
            if (used >= sizeof(buffer) - 1) goto cleanup;
        }
        for (size_t i = 0; i < capacity; i++) if (devices[i].pad && devices[i].updated && now() - devices[i].updated > 0.5) {
            if (!submit(devices[i].pad, neutral)) goto cleanup;
            devices[i].updated = 0;
        }
    }
cleanup:
    for (size_t i = 0; i < capacity; i++) if (devices[i].pad) { submit(devices[i].pad, neutral); CFRelease(devices[i].pad); }
    free(devices);
    return result;
}
