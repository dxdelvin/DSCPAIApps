from datetime import datetime
from typing import Dict, Tuple


def generate_fake_bpmn(payload: Dict) -> Tuple[bytes, str]:
    """Build a simple BPMN XML payload and filename."""
    process_name = payload.get("processName") or "bpmn_diagram"
    safe_name = "_".join(process_name.split())
    filename = f"{safe_name}.xml"

    description = payload.get("processDescription", "")
    start_event = payload.get("startEvent", "Start")
    end_event = payload.get("endEvent", "End")
    activities = payload.get("mainActivities", "")

    activities_xml = "".join(
        f"        <bpmn2:task id=\"Task_{idx}\" name=\"{_escape_xml(activity.strip())}\"/>\n"
        for idx, activity in enumerate(activities.split(","), start=1)
        if activity.strip()
    )

    xml = f"""<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<bpmn2:definitions xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"
    xmlns:bpmn2=\"http://www.omg.org/spec/BPMN/20100524/MODEL\"
    xmlns:bpmndi=\"http://www.omg.org/spec/BPMN/20100524/DI\"
    xmlns:dc=\"http://www.omg.org/spec/DD/20100524/DC\"
    xmlns:di=\"http://www.omg.org/spec/DD/20100524/DI\"
    id=\"sample_bpmn\"
    targetNamespace=\"http://example.com/bpmn\"
    xsi:schemaLocation=\"http://www.omg.org/spec/BPMN/20100524/MODEL http://www.omg.org/spec/BPMN/20100524/BPMN20.xsd\">

    <bpmn2:process id=\"Process_1\" isExecutable=\"false\">
        <bpmn2:documentation>{_escape_xml(description)}</bpmn2:documentation>
        <bpmn2:startEvent id=\"Event_1\" name=\"{_escape_xml(start_event)}\"/>
        {activities_xml or ''}
        <bpmn2:endEvent id=\"Event_End\" name=\"{_escape_xml(end_event)}\"/>
    </bpmn2:process>

    <bpmndi:BPMNDiagram id=\"BPMNDiagram_1\">
        <bpmndi:BPMNPlane id=\"BPMNPlane_1\" bpmnElement=\"Process_1\"/>
    </bpmndi:BPMNDiagram>
</bpmn2:definitions>
"""

    stamped = f"<!-- Generated {datetime.utcnow().isoformat()}Z -->\n" + xml
    return stamped.encode(), filename


def _escape_xml(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )
