# syntax=docker/dockerfile:1
# SkySpark Lite: builds Haxall from pinned source (no official prebuilt image exists).
# Derived from the pattern in haxall/haxall's own docker/Dockerfile.
ARG JDK_VERSION=17

FROM eclipse-temurin:${JDK_VERSION} AS base
WORKDIR /app/
ARG FAN_REL_VER=1.0.82
ARG FANTOM_REF
ARG XETO_REF
ARG DEFS_REF
ARG HAXALL_REF

RUN apt-get -q update && apt-get -q install -y git curl unzip && rm -rf /var/lib/apt/lists/*

# Fetch one commit of a repo without full history
COPY fetch-ref.sh /usr/local/bin/fetch-ref.sh
RUN chmod +x /usr/local/bin/fetch-ref.sh

# Fantom: bootstrap with a release, then build the pinned source with it
RUN curl -fsSL https://github.com/fantom-lang/fantom/releases/download/v${FAN_REL_VER}/fantom-${FAN_REL_VER}.zip -o fantom.zip \
 && unzip -q fantom.zip && mv fantom-${FAN_REL_VER} rel && chmod +x rel/bin/* rel/adm/*
RUN fetch-ref.sh https://github.com/fantom-lang/fantom ${FANTOM_REF} fan
RUN printf '\n\njdkHome=%s/\ndevHome=/app/fan/\n' "${JAVA_HOME}" >> rel/etc/build/config.props \
 && printf '\n\njdkHome=%s/\n' "${JAVA_HOME}" >> fan/etc/build/config.props \
 && rel/bin/fan fan/src/buildall.fan superclean \
 && rel/bin/fan fan/src/buildboot.fan compile \
 && fan/bin/fan fan/src/buildpods.fan compile
ENV FAN_SUBSTITUTE=/app/rel/
ENV PATH=$PATH:/app/fan/bin

RUN fetch-ref.sh https://github.com/Project-Haystack/xeto ${XETO_REF} xeto
RUN fetch-ref.sh https://github.com/Project-Haystack/haystack-defs ${DEFS_REF} haystack-defs
WORKDIR /app/haystack-defs/
RUN touch fan.props && fan src/build.fan clean compile

FROM eclipse-temurin:${JDK_VERSION} AS runtime
ARG HAXALL_REF
RUN apt-get -q update && apt-get -q install -y git curl && rm -rf /var/lib/apt/lists/*
COPY --from=base /app/fan/ /opt/fan/
COPY --from=base /app/haystack-defs/ /app/haystack-defs/
COPY --from=base /app/xeto/ /app/xeto/
COPY fetch-ref.sh /usr/local/bin/fetch-ref.sh
RUN chmod +x /usr/local/bin/fetch-ref.sh
ENV PATH=$PATH:/opt/fan/bin
WORKDIR /app
RUN fetch-ref.sh https://github.com/haxall/haxall ${HAXALL_REF} haxall
WORKDIR /app/haxall
# fan.props doubles as the Xeto lib search path: our own libs live in /app/specs
RUN chmod +x bin/* \
 && echo "path=../haystack-defs;../xeto;/app/specs" > fan.props \
 && fan src/build.fan clean compile

COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh
EXPOSE 8080
CMD ["/app/start.sh"]
