def run(plan):
    plan.add_service(
        name = "quantapool-bind-probe",
        config = ServiceConfig(
            image = "alpine:3.17",
            entrypoint = ["sh", "-c"],
            cmd = ["nc -lk -p 8080 -e cat"],
            ports = {"probe": PortSpec(number = 8080, transport_protocol = "TCP")},
        ),
    )
