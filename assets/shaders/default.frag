precision highp float;

varying highp vec3 vLighting;
varying highp vec2 vTextureCoord;

uniform sampler2D uSampler;
uniform vec4 uBaseColor;
uniform bool uHasTexture;

void main(void) {
    vec4 texColor = vec4(1.0); // Default to white
    if (uHasTexture) {
        texColor = texture2D(uSampler, vTextureCoord);
    }

    gl_FragColor = uBaseColor * texColor * vec4(vLighting, 1.0);
}
