#include <Arduino_RouterBridge.h>
#include <Arduino_Modulino.h>

const unsigned long SAMPLE_INTERVAL_MS = 20;
const unsigned long BEEP_INTERVAL_MS   = 600;
const int           BEEP_FREQUENCY_HZ  = 2000;
const int           BEEP_LENGTH_MS     = 300;

ModulinoMovement movement;
ModulinoBuzzer   buzzer;

bool          alarmOn      = false;
unsigned long lastSampleMs = 0;
unsigned long lastBeepMs   = 0;

void setAlarm(int on) {
  alarmOn = (on != 0);
}

void setup() {
  Bridge.begin();
  Modulino.begin();
  movement.begin();
  buzzer.begin();

  Bridge.provide("set_alarm", setAlarm);

  buzzer.tone(BEEP_FREQUENCY_HZ, 150);
}

void loop() {
  unsigned long now = millis();

  if (now - lastSampleMs >= SAMPLE_INTERVAL_MS) {
    lastSampleMs = now;
    if (movement.update() == 1) {
      Bridge.notify("record_sensor_movement",
                    movement.getX(), movement.getY(), movement.getZ());
    }
  }

  if (alarmOn && (now - lastBeepMs >= BEEP_INTERVAL_MS)) {
    lastBeepMs = now;
    buzzer.tone(BEEP_FREQUENCY_HZ, BEEP_LENGTH_MS);
  }
}
